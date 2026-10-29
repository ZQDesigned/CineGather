import type { AudioSink } from "./mixer";

// Keep processed voice on the SDK's audio element so output-device selection
// and playback gestures still work. Movie audio retains its shared video clock.
export class VoicePlayback {
  private context?: AudioContext;
  private routes = new Map<
    string,
    { release(): void; player: HTMLMediaElement }
  >();
  private warned = false;
  constructor(
    private readonly changed: () => void,
    private readonly error: (error: Error) => void,
    private readonly createContext = () => new AudioContext(),
    private readonly createInputPlayer = () => document.createElement("audio"),
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
      const routeSource = source,
        routeGain = gain,
        routeOutput = destination;
      const player = inputPlayer;
      this.routes.set(id, {
        player,
        release: () => {
          player.pause();
          player.srcObject = null;
          player.remove();
          routeSource.disconnect();
          routeGain.disconnect();
          routeOutput.stream.getTracks().forEach((t) => t.stop());
        },
      });
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
