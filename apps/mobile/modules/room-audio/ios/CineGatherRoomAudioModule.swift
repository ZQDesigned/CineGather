import ExpoModulesCore
import AVFAudio

public final class CineGatherRoomAudioModule: Module {
  private var observers: [NSObjectProtocol] = []
  public func definition() -> ModuleDefinition {
    Name("CineGatherRoomAudio")
    Events("leave", "interruption", "routeLost")
    AsyncFunction("start") { (name: String, microphone: Bool) in
      self.observe()
    }
    AsyncFunction("stop") { self.clear() }
    OnDestroy { self.clear() }
  }
  private func clear() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }
  private func observe() {
    guard observers.isEmpty else { return }
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
