import type { DesktopSettings } from "@cinegather/contracts";
import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";
import { createMicrophoneProcessor } from "./microphone-processor";
import { microphoneConstraints } from "./noise";
type Processor = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & {
  setStrength?(value: number): void;
};
export type MonitorSettings = Pick<
  DesktopSettings,
  | "inputDevice"
  | "outputDevice"
  | "noiseReduction"
  | "microphoneEffect"
  | "microphoneReverbStrength"
  | "microphoneMonitorVolume"
>;
export interface MicrophoneMonitorStatus {
  state: "off" | "starting" | "active";
  volume: number;
  outputLatencyMs?: number;
  reason?:
    | "input-unavailable"
    | "output-unavailable"
    | "processing-unavailable"
    | "device-changed";
}
export interface MonitorEnvironment {
  capture(constraints: MediaStreamConstraints): Promise<MediaStream>;
  context(): AudioContext;
  processor(settings: MonitorSettings): Promise<Processor | undefined>;
  inventory(): Promise<MediaDeviceInfo[]>;
  events():
    | Pick<MediaDevices, "addEventListener" | "removeEventListener">
    | undefined;
}
const environment: MonitorEnvironment = {
  capture: (c) => navigator.mediaDevices.getUserMedia(c),
  context: () =>
    new AudioContext({ latencyHint: "interactive", sampleRate: 48000 }),
  processor: (s) =>
    createMicrophoneProcessor(
      s.noiseReduction,
      s.microphoneEffect ?? "none",
      undefined,
      undefined,
      s.microphoneReverbStrength,
    ),
  inventory: () => navigator.mediaDevices.enumerateDevices(),
  events: () => navigator.mediaDevices,
};
type Resource = {
  stream: MediaStream;
  context?: AudioContext;
  processor?: Processor;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  player?: HTMLAudioElement;
  destination?: MediaStreamAudioDestinationNode;
  route?: "direct" | "element";
  released?: boolean;
  ended?: () => void;
};
const bounded = (v: number) =>
  Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v))) : 30;
const signature = (s: MonitorSettings) =>
  JSON.stringify([
    s.inputDevice,
    s.noiseReduction,
    s.microphoneEffect ?? "none",
  ]);
// Dedicated, explicitly enabled local capture. No SDK track, publisher or remote
// participant is used here: room mute/PTT remains independent of private monitoring.
export class MicrophoneMonitor {
  private revision = 0;
  private enabled = false;
  private resource?: Resource;
  private settings?: MonitorSettings;
  private level = 30;
  private state: MicrophoneMonitorStatus["state"] = "off";
  private reason?: MicrophoneMonitorStatus["reason"];
  private work?: Promise<void>;
  private outputFingerprint?: string;
  constructor(
    private readonly changed: (status: MicrophoneMonitorStatus) => void,
    private readonly env: MonitorEnvironment = environment,
  ) {}
  get status(): MicrophoneMonitorStatus {
    const c = this.resource?.context as
      | (AudioContext & { outputLatency?: number })
      | undefined;
    return {
      state: this.state,
      volume: this.level,
      reason: this.reason,
      outputLatencyMs:
        this.resource?.route === "direct" && c
          ? ((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000
          : undefined,
    };
  }
  private emit() {
    this.changed(this.status);
  }
  volume(value: number) {
    this.level = bounded(value);
    const r = this.resource;
    if (r?.gain && r.context && this.state === "active")
      r.gain.gain.setTargetAtTime(
        this.level / 100,
        r.context.currentTime,
        0.02,
      );
    this.emit();
  }
  strength(value: number) {
    if (this.settings)
      this.settings = { ...this.settings, microphoneReverbStrength: value };
    this.resource?.processor?.setStrength?.(value);
  }
  enable(settings: MonitorSettings) {
    if (this.enabled) return this.configure(settings);
    this.enabled = true;
    this.env.events()?.addEventListener("devicechange", this.deviceChanged);
    return this.start(settings);
  }
  async configure(settings: MonitorSettings): Promise<void> {
    if (!this.enabled) return;
    const before = this.settings;
    this.settings = { ...settings };
    this.volume(settings.microphoneMonitorVolume ?? 30);
    this.strength(settings.microphoneReverbStrength ?? 40);
    if (!before || signature(before) !== signature(settings))
      return this.start(settings);
    if (this.state === "starting") return this.work;
    if (before.outputDevice !== settings.outputDevice && this.resource) {
      const r = this.resource,
        generation = this.revision;
      r.gain!.gain.setValueAtTime(0, r.context!.currentTime);
      try {
        await this.route(r, settings.outputDevice);
        if (generation !== this.revision) return;
        this.outputFingerprint = await this.fingerprint();
        if (generation !== this.revision) return;
        this.volume(this.level);
      } catch {
        if (generation !== this.revision) return;
        await this.stop("output-unavailable");
        throw new Error("无法使用所选输出设备，耳返已关闭");
      }
    }
  }
  private start(settings: MonitorSettings) {
    const generation = ++this.revision;
    this.settings = { ...settings };
    this.level = bounded(settings.microphoneMonitorVolume ?? 30);
    this.state = "starting";
    this.reason = undefined;
    const old = this.resource;
    this.resource = undefined;
    void this.release(old);
    this.emit();
    const active = () => generation === this.revision && this.enabled;
    const work = (async () => {
      let resource: Resource | undefined;
      let reason: MicrophoneMonitorStatus["reason"] = "input-unavailable";
      try {
        const stream = await this.env.capture({
          audio: {
            ...microphoneConstraints(settings.noiseReduction),
            deviceId: settings.inputDevice
              ? { exact: settings.inputDevice }
              : undefined,
          },
          video: false,
        });
        resource = { stream };
        if (!active()) {
          await this.release(resource);
          return;
        }
        this.resource = resource;
        const r = resource;
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState === "ended") throw Error("input-ended");
        r.ended = () => {
          if (active()) void this.stop("device-changed");
        };
        track.addEventListener("ended", r.ended);
        r.context = this.env.context();
        reason = "processing-unavailable";
        const processor = await this.env.processor(settings);
        if (!active()) {
          await processor?.destroy();
          await this.release(r);
          return;
        }
        r.processor = processor;
        await r.processor?.init({
          kind: "audio" as Track.Kind.Audio,
          track,
          audioContext: r.context,
        });
        if (!active()) {
          await this.release(r);
          return;
        }
        r.processor?.setStrength?.(
          this.settings!.microphoneReverbStrength ?? 40,
        );
        r.source = r.context.createMediaStreamSource(
          r.processor?.processedTrack
            ? new MediaStream([r.processor.processedTrack])
            : stream,
        );
        r.gain = r.context.createGain();
        r.gain.gain.value = 0;
        r.source.connect(r.gain);
        reason = "output-unavailable";
        await this.route(r, this.settings!.outputDevice);
        if (!active()) {
          await this.release(r);
          return;
        }
        this.outputFingerprint = await this.fingerprint();
        await r.context.resume();
        if (!active()) {
          await this.release(r);
          return;
        }
        this.state = "active";
        r.gain.gain.setValueAtTime(this.level / 100, r.context.currentTime);
        this.emit();
      } catch {
        await this.release(resource);
        if (!active()) return;
        await this.stop(reason);
        throw new Error(
          reason === "input-unavailable"
            ? "无法使用麦克风，耳返未开启"
            : reason === "output-unavailable"
              ? "无法使用所选输出设备，耳返已关闭"
              : "耳返音效未能启动，请重试",
        );
      }
    })();
    this.work = work;
    return work;
  }
  private async route(r: Resource, output: string) {
    const context = r.context! as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (context.setSinkId) {
      await context.setSinkId(output || "");
      if (!r.route) {
        r.gain!.connect(context.destination);
        r.route = "direct";
      }
      return;
    }
    if (!output && r.route !== "element") {
      if (!r.route) {
        r.gain!.connect(context.destination);
        r.route = "direct";
      }
      return;
    }
    const player = r.player ?? new Audio();
    if (typeof player.setSinkId !== "function")
      throw Error("output-selection-unavailable");
    if (!r.player) {
      r.player = player;
      r.destination = context.createMediaStreamDestination();
      r.gain!.disconnect();
      r.gain!.connect(r.destination);
      player.srcObject = r.destination.stream;
      r.route = "element";
    }
    await player.setSinkId(output || "");
    await player.play();
  }
  private async fingerprint() {
    const devices = await this.env.inventory();
    const output = this.settings?.outputDevice;
    const device = devices.find(
      (d) => d.kind === "audiooutput" && d.deviceId === (output || "default"),
    );
    return device
      ? device.groupId || device.label || device.deviceId
      : undefined;
  }
  private deviceChanged = () => {
    const generation = this.revision;
    if (!this.enabled) return;
    void this.fingerprint()
      .then((next) => {
        if (
          generation === this.revision &&
          this.outputFingerprint &&
          next !== this.outputFingerprint
        )
          void this.stop("device-changed");
      })
      .catch(() => {});
  };
  async stop(reason?: MicrophoneMonitorStatus["reason"]) {
    ++this.revision;
    this.enabled = false;
    this.state = "off";
    this.reason = reason;
    this.env.events()?.removeEventListener("devicechange", this.deviceChanged);
    this.outputFingerprint = undefined;
    const resource = this.resource;
    this.resource = undefined;
    this.emit();
    await this.release(resource);
  }
  private async release(r?: Resource) {
    if (!r || r.released) return;
    r.released = true;
    if (r.gain && r.context)
      r.gain.gain.setValueAtTime(0, r.context.currentTime);
    for (const t of r.stream.getTracks()) {
      if (r.ended) t.removeEventListener("ended", r.ended);
      t.stop();
    }
    r.source?.disconnect();
    r.gain?.disconnect();
    r.player?.pause();
    if (r.player) r.player.srcObject = null;
    r.destination?.stream.getTracks().forEach((t) => t.stop());
    await Promise.allSettled([
      r.processor?.destroy(),
      r.context && r.context.state !== "closed" ? r.context.close() : undefined,
    ]);
  }
}
