import type { AudioSink } from "./mixer";

// Keep processed voice on the SDK's audio element so output-device selection
// and playback gestures still work. Movie audio retains its shared video clock.
export class VoicePlayback {
  private context?: AudioContext;
  private routes = new Map<
    string,
    { release(): void; player: HTMLMediaElement; connectOutput?: () => void }
  >();
  private warned = false;
  private outputDevice = "";
  get latency() {
    const c = this.context;
    return {
      playbackContextState: c?.state,
      playbackBaseMs:
        c && Number.isFinite(c.baseLatency) ? c.baseLatency * 1000 : undefined,
      outputLatencyMs:
        c && Number.isFinite(c.outputLatency)
          ? c.outputLatency * 1000
          : undefined,
    };
  }
  private outputSetup?: {
    context: AudioContext;
    id: string;
    ready: Promise<void>;
  };
  async device(id: string) {
    this.outputDevice = id;
    const context = this.context;
    if (!context || !this.direct) return;
    if (id && !("setSinkId" in context))
      throw new Error("当前设备不支持指定音乐输出，请使用系统默认输出");
    if (this.outputSetup?.context !== context || this.outputSetup.id !== id) {
      const ready = Promise.resolve().then(async () => {
        if ("setSinkId" in context)
          await (
            context as AudioContext & { setSinkId(id: string): Promise<void> }
          ).setSinkId(id);
      });
      this.outputSetup = { context, id, ready };
      void ready.catch(() => {
        if (this.outputSetup?.ready === ready) this.outputSetup = undefined;
      });
    }
    const setup = this.outputSetup;
    await setup.ready;
    if (
      this.context === context &&
      this.outputDevice === id &&
      this.outputSetup === setup
    )
      for (const route of this.routes.values()) route.connectOutput?.();
  }

  constructor(
    private readonly changed: () => void,
    private readonly error: (error: Error) => void,
    private readonly createContext = () => new AudioContext(),
    private readonly createInputPlayer = () => document.createElement("audio"),
    private readonly direct = false,
  ) {}
  get blocked() {
    return (
      this.routes.size > 0 &&
      (this.context?.state !== "running" ||
        [...this.routes.values()].some((r) => r.player.paused))
    );
  }
  attach(
    id: string,
    input: MediaStream,
    element: HTMLMediaElement,
    fallback: AudioSink,
  ): AudioSink {
    this.remove(id);
    let source: MediaStreamAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    let destination: MediaStreamAudioDestinationNode | undefined;
    let inputPlayer: HTMLMediaElement | undefined;
    try {
      const context = (this.context ??= this.createContext());
      context.onstatechange = this.changed;
      // Chromium's remote RTC audio requires a playing media element for the
      // original stream, even when a Web Audio node consumes that stream.
      // Keep it permanently muted; only the processed SDK element is audible.
      inputPlayer = this.createInputPlayer();
      inputPlayer.srcObject = input;
      inputPlayer.muted = true;
      inputPlayer.volume = 0;
      inputPlayer.autoplay = true;
      inputPlayer.style.display = "none";
      inputPlayer.dataset.cinegatherVoiceInput = "";
      element.parentNode?.appendChild(inputPlayer);
      source = context.createMediaStreamSource(input);
      gain = context.createGain();
      gain.gain.value = 0;
      destination = context.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);
      element.srcObject = destination.stream;
      // All attenuation/amplification lives in the graph, with no parallel raw output.
      element.volume = 1;
      element.muted = this.direct;
      if (this.direct) {
        if (this.outputDevice && !("setSinkId" in context))
          throw new Error("Direct audio output selection unavailable");
        element.muted = true;
      }
      const routeSource = source,
        routeGain = gain,
        routeOutput = destination;
      const player = inputPlayer;
      let active = true,
        connected = false;
      this.routes.set(id, {
        connectOutput: this.direct
          ? () => {
              if (active && !connected) {
                routeGain.connect(context.destination);
                connected = true;
              }
            }
          : undefined,
        player,
        release: () => {
          active = false;
          player.pause();
          player.srcObject = null;
          player.remove();
          routeSource.disconnect();
          routeGain.disconnect();
          routeOutput.stream.getTracks().forEach((t) => t.stop());
        },
      });
      if (this.direct) void this.device(this.outputDevice).catch(this.error);
      void this.resume().catch(() => this.changed());
      this.changed();
      return {
        setVolume: (value) => {
          const level = Number.isFinite(value)
            ? Math.max(0, Math.min(2, value))
            : 0;
          routeGain.gain.setTargetAtTime(level, context.currentTime, 0.02);
        },
      };
    } catch {
      if (inputPlayer) {
        inputPlayer.pause();
        inputPlayer.srcObject = null;
        inputPlayer.remove();
      }
      source?.disconnect();
      gain?.disconnect();
      destination?.stream.getTracks().forEach((t) => t.stop());
      element.srcObject = input;
      element.muted = false;
      return {
        setVolume: (value) => {
          const level = Number.isFinite(value)
            ? Math.max(0, Math.min(1, value))
            : 0;
          fallback.setVolume(level);
          if (value > 1 && !this.warned) {
            this.warned = true;
            this.error(
              new Error("当前设备暂不支持语音放大，已按最高 100% 播放"),
            );
          }
        },
      };
    }
  }
  async resume() {
    await Promise.all([
      this.context?.state === "suspended" ? this.context.resume() : undefined,
      ...[...this.routes.values()].map((r) => r.player.play()),
    ]);
    this.changed();
  }
  remove(id: string) {
    this.routes.get(id)?.release();
    this.routes.delete(id);
  }
  clear() {
    for (const id of this.routes.keys()) this.remove(id);
    const context = this.context;
    this.context = undefined;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
  }
}
