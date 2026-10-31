import ExpoModulesCore
import ReplayKit

#if canImport(ScreenCaptureKit)
  import ScreenCaptureKit
#endif

private protocol CaptureDriver: AnyObject {
  var diagnostics: [String: Any] { get }
  func start()
  func stop()
  func renew(_ expiresAt: Double)
}
public final class CineGatherScreenShareModule: Module {
  private var driver: CaptureDriver?
  private var captureID: String?
  private var pending: Promise?
  private var expiry: DispatchSourceTimer?
  private var expiresAt: Double = 0
  public func definition() -> ModuleDefinition {
    Name("CineGatherScreenShare")
    Events("status")
    AsyncFunction("start") { (options: [String: Any], promise: Promise) in
      guard self.driver == nil, let id = options["id"] as? String else {
        promise.reject("CAPTURE_BUSY", "已有共享正在运行")
        return
      }
      self.captureID = id
      self.pending = promise
      self.expiresAt = (options["expiresAt"] as? Double ?? 0) / 1000
      let timer = DispatchSource.makeTimerSource(queue: .main)
      timer.schedule(deadline: .now() + 1, repeating: 1)
      timer.setEventHandler { [weak self] in
        guard let self, self.captureID == id else { return }
        if Date().timeIntervalSince1970 >= self.expiresAt {
          self.sendEvent("status", ["id": id, "state": "stopped", "reason": "共享授权已到期，请重新共享"])
          self.clear()
        }
      }
      self.expiry = timer
      timer.resume()
      let status: (String, String) -> Void = { [weak self] state, reason in
        DispatchQueue.main.async {
          guard let self, self.captureID == id else { return }
          self.sendEvent("status", ["id": id, "state": state, "reason": reason])
          if state == "active" {
            self.pending?.resolve(nil)
            self.pending = nil
          }
          if state == "stopped" || state == "failed" {
            self.pending?.reject("CAPTURE_STOPPED", reason.isEmpty ? "共享已停止" : reason)
            self.pending = nil
            self.expiry?.cancel()
            self.expiry = nil
            self.driver?.stop()
            self.driver = nil
            self.captureID = nil
          }
        }
      }
      #if canImport(ScreenCaptureKit)
        if #available(iOS 27.0, *) {
          self.driver = ScreenKitDriver(options: options, status: status)
        } else {
          self.driver = ReplayDriver(options: options, status: status)
        }
      #else
        promise.reject("CAPTURE_UNAVAILABLE", "模拟器不支持屏幕共享，请使用真机测试")
        self.clear()
        return
      #endif
      self.driver?.start()
      DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
        guard let self, self.captureID == id, self.pending != nil else { return }
        status("stopped", "系统共享授权超时，请重新开始")
      }
    }.runOnQueue(.main)
    AsyncFunction("stop") { (id: String) in
      if self.captureID == id { self.clear() }
    }.runOnQueue(.main)
    AsyncFunction("renew") { (id: String, expiresAt: Double) in
      if self.captureID == id {
        self.expiresAt = expiresAt / 1000
        self.driver?.renew(expiresAt)
      }
    }.runOnQueue(.main)
    AsyncFunction("diagnostics") { self.driver?.diagnostics ?? [:] }.runOnQueue(.main)
    OnDestroy { DispatchQueue.main.async { self.clear() } }
  }
  private func clear() {
    expiry?.cancel()
    expiry = nil
    let driver = self.driver
    self.driver = nil
    self.captureID = nil
    pending?.reject("CAPTURE_STOPPED", "共享已停止")
    pending = nil
    driver?.stop()
  }
}

#if canImport(ScreenCaptureKit)
  @available(iOS 27.0, *)
  private final class ScreenKitDriver: NSObject, CaptureDriver, SCContentSharingPickerObserver,
    SCStreamDelegate, SCStreamOutput
  {
    private let options: [String: Any]
    private let status: (String, String) -> Void
    private let publisher = CGScreenPublisher()
    private let samples = DispatchQueue(
      label: "city.zqdesigned.cinegather.screen-samples", qos: .userInitiated)
    private var stream: SCStream?
    private var stopped = false
    private var selecting = true
    init(options: [String: Any], status: @escaping (String, String) -> Void) {
      self.options = options
      self.status = status
    }
    var diagnostics: [String: Any] {
      var result = publisher.diagnostics as? [String: Any] ?? [:]
      result["engine"] = "screencapturekit"
      result["excludesSelf"] = true
      return result
    }
    func renew(_ expiresAt: Double) {}
    func start() {
      let picker = SCContentSharingPicker.shared
      guard picker.isAvailable else {
        status("failed", "当前设备不允许屏幕录制，请检查系统限制")
        return
      }
      var config = SCContentSharingPickerConfiguration()
      config.showsMicrophoneControl = false
      picker.defaultConfiguration = config
      picker.add(self)
      picker.isActive = true
      picker.present()
    }
    func stop() {
      guard !stopped else { return }
      stopped = true
      let picker = SCContentSharingPicker.shared
      picker.remove(self)
      picker.isActive = false
      if let stream { stream.stopCapture { _ in } }
      stream = nil
      samples.sync { publisher.stop() }
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
      status("stopped", "已取消系统共享授权")
    }
    func contentSharingPickerStartDidFailWithError(_ error: Error) {
      status("failed", "系统共享选择器无法打开：\(error.localizedDescription)")
    }
    func contentSharingPicker(
      _ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?
    ) {
      DispatchQueue.main.async { [weak self] in
        guard let self, !self.stopped, self.selecting else { return }
        self.selecting = false
        let config = SCStreamConfiguration()
        // iOS owns capture cadence and buffering. The native WebRTC source
        // and RTP sender enforce the selected frame rate.
        config.capturesAudio = self.options["audio"] as? Bool ?? false
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        let capture = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = capture
        do {
          try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.samples)
          if config.capturesAudio {
            try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.samples)
          }
        } catch {
          self.status("failed", "无法初始化系统共享：\(error.localizedDescription)")
          return
        }
        self.publisher.status = self.status
        self.publisher.start(self.options) { [weak self] error in
          if let error { self?.status("failed", error.localizedDescription) }
        }
        capture.startCapture { [weak self] error in
          if let error { self?.status("failed", "系统采集失败：\(error.localizedDescription)") }
        }
      }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
      status("stopped", "系统已停止屏幕共享")
    }
    func stream(
      _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
      of type: SCStreamOutputType
    ) {
      guard !stopped else { return }
      if type == .screen {
        publisher.video(sampleBuffer)
      } else if type == .audio {
        publisher.audio(sampleBuffer)
      }
    }
  }

#endif

private final class ReplayDriver: CaptureDriver {
  private let options: [String: Any]
  private let status: (String, String) -> Void
  private var timer: DispatchSourceTimer?
  private var picker: RPSystemBroadcastPickerView?
  private var file: URL?
  private var report: URL?
  private var lastState: String?
  private var stopped = false
  private var result: [String: Any] = [:]
  init(options: [String: Any], status: @escaping (String, String) -> Void) {
    self.options = options
    self.status = status
  }
  var diagnostics: [String: Any] { result }
  func start() {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "CGScreenShareGroup") as? String,
      let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let bundle = Bundle.main.bundleIdentifier
    else {
      status("failed", "当前安装包缺少系统广播扩展，请安装包含屏幕共享能力的完整客户端")
      return
    }
    file = root.appendingPathComponent("capture.json")
    report = root.appendingPathComponent("capture-status.json")
    var config = options
    config["authorizationDeadline"] = Date().timeIntervalSince1970 + 90
    do {
      try? FileManager.default.removeItem(at: report!)
      let data = try JSONSerialization.data(withJSONObject: config)
      try data.write(
        to: file!, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    } catch {
      status("failed", "无法准备系统广播授权")
      return
    }
    let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    picker.preferredExtension = bundle + ".broadcast"
    picker.showsMicrophoneButton = false
    self.picker = picker
    guard let button = picker.subviews.first(where: { $0 is UIButton }) as? UIButton else {
      status("failed", "无法打开系统广播面板")
      return
    }
    button.sendActions(for: .touchUpInside)
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now(), repeating: .milliseconds(500))
    timer.setEventHandler { [weak self] in self?.poll() }
    self.timer = timer
    timer.resume()
  }
  func renew(_ expiresAt: Double) {
    guard !stopped, let file, let data = try? Data(contentsOf: file),
      var config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      config["id"] as? String == options["id"] as? String
    else { return }
    config["expiresAt"] = expiresAt
    if let data = try? JSONSerialization.data(withJSONObject: config) {
      try? data.write(
        to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
  }
  private func poll() {
    guard !stopped, let report, let data = try? Data(contentsOf: report), data.count < 64 * 1024,
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      value["id"] as? String == options["id"] as? String
    else { return }
    result = value["diagnostics"] as? [String: Any] ?? [:]
    if let state = value["state"] as? String, state != lastState {
      lastState = state
      status(state, value["reason"] as? String ?? "")
    }
  }
  func stop() {
    if stopped { return }
    stopped = true
    timer?.cancel()
    timer = nil
    picker = nil
    if let file { try? FileManager.default.removeItem(at: file) }
    if let report { try? FileManager.default.removeItem(at: report) }
  }
}
