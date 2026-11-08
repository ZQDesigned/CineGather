#pragma once
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <exception>
#include <functional>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace cinegather {
// Only fixed codes and timing leave this tracker. No HWND, title, path or
// token.
class CaptureProgress {
public:
  using Clock = std::function<double()>;
  using Sink = std::function<void(const std::string &)>;
  enum class Stage {
    Command,
    ReplyWrite,
    Cleanup,
    VideoSource,
    AudioSource,
    EngineInit,
    SceneBind,
    WindowSizeGraphics,
    Adapter,
    VideoReset,
    Scene,
    VideoEncoder,
    AudioEncoder,
    Service,
    Output,
    EncoderInitialize,
    OutputStart,
    StartAck,
    SourceWarm,
    SourceCommit,
    WindowInit,
    WindowFree,
    WindowInitGraphics,
    WindowFreeGraphics,
    AdapterGraphics,
    StatusPreview,
    StatusNetwork,
    StatusSize,
    StatusOutput,
    StatusRender,
    StatusAudio
  };
  static const char *name(Stage s) {
    switch (s) {
    case Stage::Command:
      return "command";
    case Stage::ReplyWrite:
      return "reply-write";
    case Stage::Cleanup:
      return "cleanup";
    case Stage::VideoSource:
      return "video-source-create";
    case Stage::AudioSource:
      return "audio-source-create";
    case Stage::EngineInit:
      return "engine-init";
    case Stage::SceneBind:
      return "scene-bind";
    case Stage::WindowSizeGraphics:
      return "window-size-graphics";
    case Stage::Adapter:
      return "adapter-select";
    case Stage::VideoReset:
      return "video-reset";
    case Stage::Scene:
      return "scene-create";
    case Stage::VideoEncoder:
      return "video-encoder-create";
    case Stage::AudioEncoder:
      return "audio-encoder-create";
    case Stage::Service:
      return "service-create";
    case Stage::Output:
      return "output-create";
    case Stage::EncoderInitialize:
      return "encoder-initialize";
    case Stage::OutputStart:
      return "output-start";
    case Stage::StartAck:
      return "start-ack";
    case Stage::SourceWarm:
      return "source-warm";
    case Stage::SourceCommit:
      return "source-commit";
    case Stage::WindowInit:
      return "window-capture-init";
    case Stage::WindowFree:
      return "window-capture-free";
    case Stage::WindowInitGraphics:
      return "window-init-graphics";
    case Stage::WindowFreeGraphics:
      return "window-free-graphics";
    case Stage::AdapterGraphics:
      return "adapter-graphics";
    case Stage::StatusPreview:
      return "status-preview";
    case Stage::StatusNetwork:
      return "status-network";
    case Stage::StatusSize:
      return "status-size";
    case Stage::StatusOutput:
      return "status-output";
    case Stage::StatusRender:
      return "status-render";
    case Stage::StatusAudio:
      return "status-audio";
    }
    return "unknown";
  }
  enum class Command {
    None,
    Status,
    Permission,
    Windows,
    Encoders,
    Thumbnails,
    Probe,
    Start,
    Switch,
    Stop,
    Renew,
    Shutdown,
    PreviewStart,
    PreviewAnswer,
    PreviewStop,
    Unknown
  };
  static const char *name(Command c) {
    switch (c) {
    case Command::None:
      return "none";
    case Command::Status:
      return "status";
    case Command::Permission:
      return "requestPermission";
    case Command::Windows:
      return "windows";
    case Command::Encoders:
      return "encoders";
    case Command::Thumbnails:
      return "thumbnails";
    case Command::Probe:
      return "probe";
    case Command::Start:
      return "start";
    case Command::Switch:
      return "switch-source";
    case Command::Stop:
      return "stop";
    case Command::Renew:
      return "renew";
    case Command::Shutdown:
      return "shutdown";
    case Command::PreviewStart:
      return "preview-start";
    case Command::PreviewAnswer:
      return "preview-answer";
    case Command::PreviewStop:
      return "preview-stop";
    case Command::Unknown:
      return "unknown";
    }
    return "unknown";
  }
  static Command command(const std::string &raw) {
    for (auto c : {Command::Status, Command::Permission, Command::Windows, Command::Encoders,
                   Command::Thumbnails, Command::Probe, Command::Start, Command::Switch,
                   Command::Stop, Command::Renew, Command::Shutdown, Command::PreviewStart,
                   Command::PreviewAnswer, Command::PreviewStop})
      if (raw == name(c))
        return c;
    return Command::Unknown;
  }
  enum class Source { None, Window, Screen, Synthetic };
  struct Context {
    uint64_t sequence = 0;
    Command command = Command::None;
    Source source = Source::None;
  };

private:
  struct Pending {
    Context context;
    Stage stage;
    double start, last;
    bool trace, reported = false, acquired = false;
    double wait = 0;
  };
  Sink sink;
  Clock clock;
  std::mutex mutex;
  std::map<uint64_t, Pending> pending;
  uint64_t next = 0, commandSequence = 0, eventSequence = 0;
  Context context;
  std::string event(uint64_t span, const Pending &p, const char *state, double now) {
    const char *source = p.context.source == Source::Window      ? "window"
                         : p.context.source == Source::Screen    ? "screen"
                         : p.context.source == Source::Synthetic ? "synthetic"
                                                                 : "none";
    std::ostringstream out;
    out << "{\"sequence\":" << ++eventSequence << ",\"span\":" << span
        << ",\"commandSequence\":" << p.context.sequence << ",\"command\":\""
        << name(p.context.command) << "\",\"sourceKind\":\"" << source << "\",\"stage\":\""
        << name(p.stage) << "\",\"state\":\"" << state
        << "\",\"elapsedMs\":" << std::max(0.0, now - p.start);
    if (p.acquired)
      out << ",\"waitMs\":" << p.wait;
    out << "}";
    return out.str();
  }
  void emit(const std::string &value) noexcept {
    if (!value.empty()) {
      try {
        sink(value);
      } catch (...) {
      }
    }
  }
  uint64_t begin(Stage stage, bool trace, bool newCommand, Command command, Source source) {
    std::string value;
    uint64_t id;
    {
      std::lock_guard<std::mutex> l(mutex);
      if (newCommand)
        context = {++commandSequence, command, source};
      id = ++next;
      double now = clock();
      Pending p{context, stage, now, now, trace};
      // Scopes are bounded by the number of host threads; reject diagnostic
      // overflow rather than allowing telemetry to exhaust the capture host.
      if (pending.size() >= 64)
        return 0;
      pending.emplace(id, p);
      if (trace)
        value = event(id, p, "begin", now);
    }
    emit(value);
    return id;
  }
  void acquired(uint64_t id) {
    std::string value;
    {
      std::lock_guard<std::mutex> l(mutex);
      auto it = pending.find(id);
      if (it == pending.end())
        return;
      auto &p = it->second;
      double now = clock();
      p.wait = std::max(0.0, now - p.start);
      p.acquired = true;
      if (p.trace || p.reported || p.wait >= 250)
        value = event(id, p, "acquired", now);
    }
    emit(value);
  }
  void finish(uint64_t id, bool failed) {
    std::string value;
    {
      std::lock_guard<std::mutex> l(mutex);
      auto it = pending.find(id);
      if (it == pending.end())
        return;
      auto p = it->second;
      double now = clock();
      if (p.trace || p.reported || now - p.start >= 250 || failed)
        value = event(id, p, failed ? "failed" : "complete", now);
      if (p.stage == Stage::Command && p.context.sequence == context.sequence)
        context.command = Command::None;
      pending.erase(it);
    }
    emit(value);
  }

public:
  explicit CaptureProgress(
      Sink sink, Clock clock =
                     [] {
                       return std::chrono::duration<double, std::milli>(
                                  std::chrono::steady_clock::now().time_since_epoch())
                           .count();
                     })
      : sink(std::move(sink)), clock(std::move(clock)) {}
  class Span {
    CaptureProgress &owner;
    uint64_t id;
    int exceptions = std::uncaught_exceptions();

  public:
    Span(CaptureProgress &o, Stage s, bool trace, bool newCommand = false,
         Command c = Command::None, Source source = Source::None)
        : owner(o), id(o.begin(s, trace, newCommand, c, source)) {}
    Span(const Span &) = delete;
    ~Span() {
      owner.finish(id, std::uncaught_exceptions() > exceptions);
    }
    void acquired() {
      owner.acquired(id);
    }
  };
  Span span(Stage stage, bool trace = true) {
    return Span(*this, stage, trace);
  }
  Span beginCommand(Command c, Source source) {
    return Span(*this, Stage::Command, c != Command::Status && c != Command::Renew, true, c,
                source);
  }
  // Called by the independent watchdog. It does not touch OBS or graphics.
  void poll() {
    std::vector<std::string> events;
    {
      std::lock_guard<std::mutex> l(mutex);
      double now = clock();
      for (auto &[id, p] : pending)
        if (now - p.start >= 250 && (!p.reported || now - p.last >= 1000)) {
          p.last = now;
          p.reported = true;
          events.push_back(event(id, p, p.acquired ? "held" : "waiting", now));
        }
    }
    for (const auto &e : events)
      emit(e);
  }
};
// RAII pairs graphics release even if WinRT/adapter initialization throws.
class CaptureGraphicsLock {
  CaptureProgress::Span trace;
  void (*leave)();

public:
  CaptureGraphicsLock(CaptureProgress &p, CaptureProgress::Stage s, void (*enter)(),
                      void (*leave)())
      : trace(p, s, false), leave(leave) {
    enter();
    trace.acquired();
  }
  ~CaptureGraphicsLock() {
    leave();
  }
  CaptureGraphicsLock(const CaptureGraphicsLock &) = delete;
};
// The command thread reads only this atomic snapshot, never the WinRT pointer
// or the graphics lock. Zero means no usable capture size has arrived yet.
class CaptureDimensions {
  std::atomic<uint64_t> size{0};

public:
  void set(uint32_t width, uint32_t height) {
    size.store(uint64_t(width) << 32 | height, std::memory_order_release);
  }
  uint32_t width() const {
    return uint32_t(size.load(std::memory_order_acquire) >> 32);
  }
  uint32_t height() const {
    return uint32_t(size.load(std::memory_order_acquire));
  }
};
} // namespace cinegather
