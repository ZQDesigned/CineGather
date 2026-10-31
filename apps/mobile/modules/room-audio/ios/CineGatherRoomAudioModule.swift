import ExpoModulesCore
import AVFAudio

public final class CineGatherRoomAudioModule: Module {
  private var criticalTimers: [Int: DispatchSourceTimer] = [:]
  private var timer: DispatchSourceTimer?
  private var observers: [NSObjectProtocol] = []
  public func definition() -> ModuleDefinition {
    Name("CineGatherRoomAudio")
    Events("leave", "interruption", "routeLost", "tick", "timer")
    Function("scheduleTimer") { [weak self] (id: Int, delay: Double, repeating: Bool) in
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.criticalTimers.removeValue(forKey: id)?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        let interval = max(1, delay) / 1000
        if repeating { timer.schedule(deadline: .now() + interval, repeating: interval) }
        else { timer.schedule(deadline: .now() + interval) }
        timer.setEventHandler { [weak self] in
          guard let self, self.criticalTimers[id] != nil else { return }
          if !repeating { self.criticalTimers.removeValue(forKey: id)?.cancel() }
          self.sendEvent("timer", ["id": id])
        }
        self.criticalTimers[id] = timer
        timer.resume()
      }
    }
    Function("cancelTimer") { (id: Int) in DispatchQueue.main.async { self.criticalTimers.removeValue(forKey: id)?.cancel() } }
    AsyncFunction("requestMicrophonePermission") { () async -> Bool in
      await withCheckedContinuation { continuation in
        AVAudioSession.sharedInstance().requestRecordPermission { granted in continuation.resume(returning: granted) }
      }
    }
    AsyncFunction("start") { (name: String, microphone: Bool) in
      self.observe()
    }.runOnQueue(.main)
    AsyncFunction("stop") { self.clear() }.runOnQueue(.main)
    OnDestroy { DispatchQueue.main.async { self.clear(); self.criticalTimers.values.forEach { $0.cancel() }; self.criticalTimers.removeAll() } }
  }
  private func clear() {
    timer?.cancel(); timer = nil
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }
  private func observe() {
    guard observers.isEmpty else { return }
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 5, repeating: 5)
    timer.setEventHandler { [weak self] in self?.sendEvent("tick", [:]) }
    self.timer = timer
    timer.resume()
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      let options = AVAudioSession.InterruptionOptions(rawValue: notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
      self?.sendEvent("interruption", ["interrupted": type == .began || !options.contains(.shouldResume)])
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
      if let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
         AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable {
        self?.sendEvent("routeLost", [:])
      }
    })
  }
}
