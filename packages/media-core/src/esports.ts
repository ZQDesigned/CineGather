import type {
  DesktopSettings,
  RoomControl,
  WatchProfile,
} from "@cinegather/contracts";
import { MediaSession, type MediaSummary } from "./session";
import { waitForEsportsFrame } from "./esports-frame";
type Kind = "voice" | "video" | "monitor";
interface Connection {
  channel: string;
  url: string;
  token: string;
  seatRevision: number;
}
export interface EsportsBrowserHandle {
  session: MediaSession;
  element?: HTMLVideoElement;
  kind: Kind;
  channel: string;
  ready(signal: AbortSignal): Promise<void>;
  connected(): boolean;
  close(): Promise<void>;
  video(enabled: boolean): void;
  audio(enabled: boolean): void;
}
// Reuse the normal microphone DSP/output path, but each session connects only to
// a server-authorized isolated channel. Warming outputs start at zero gain.
export class EsportsBrowserMedia {
  private handles = new Set<EsportsBrowserHandle>();
  private container?: HTMLElement;
  private selected?: EsportsBrowserHandle;
  private parking?: HTMLElement;
  private levels = {
    voice: 1,
    screen: 1,
    members: {} as Record<string, number>,
  };
  private devices: { input?: string; output?: string } = {};
  private profile: WatchProfile = "balanced";
  constructor(
    private readonly callbacks: {
      changed(summary: MediaSummary, kind: Kind, channel: string): void;
      error(error: unknown): void;
      controlled?(command: RoomControl): void;
      inputLost?(): void;
      disconnected?(kind: Kind, channel: string): void;
    },
  ) {}
  get viewing() {
    return this.selected?.session;
  }
  get voice() {
    return [...this.handles].find((h) => h.kind === "voice")?.session;
  }
  async open(
    connection: Connection,
    kind: Kind,
    signal: AbortSignal,
  ): Promise<EsportsBrowserHandle> {
    if (signal.aborted) throw signal.reason;
    let closed = false,
      audible = false;
    const element =
      kind === "video" ? document.createElement("video") : undefined;
    if (element) {
      element.autoplay = true;
      element.playsInline = true;
      element.muted = true;
      element.dataset.esportsVideo = connection.channel;
      this.park(element);
    }
    const session = new MediaSession(
      (summary) => {
        if (closed) return;
        if (kind === "video" && summary.sharer && !summary.watching) {
          session.watch(true);
          return;
        }
        if (element && !audible) element.volume = 0;
        this.callbacks.changed(summary, kind, connection.channel);
      },
      this.callbacks.error,
      () => {},
      () => {
        if (!closed) {
          if (this.callbacks.disconnected)
            this.callbacks.disconnected(kind, connection.channel);
          else if (kind === "voice")
            this.callbacks.error(new Error("席位语音已断开，请重新连接房间"));
        }
      },
      this.callbacks.controlled,
      this.callbacks.inputLost,
    );
    session.voiceVolume(0);
    session.screenVolume(0);
    session.memberVolumes(this.levels.members);
    session.setWatchProfile(this.profile);
    if (element) session.setVideoElement(element);
    const handle: EsportsBrowserHandle = {
      session,
      connected: () => !closed && session.isConnected(),
      element,
      kind,
      channel: connection.channel,
      ready: (s) =>
        element ? waitForEsportsFrame(element, s) : Promise.resolve(),
      close: async () => {
        if (closed) return;
        closed = true;
        this.handles.delete(handle);
        if (this.selected === handle) {
          this.selected = undefined;
          this.container?.replaceChildren();
        }
        await session.disconnect();
        element?.remove();
      },
      video: (value) => session.setVideoVisible(value),
      audio: (value) => {
        audible = value;
        session.voiceVolume(value ? this.levels.voice : 0);
        session.screenVolume(value ? this.levels.screen : 0);
        if (element) element.volume = value ? this.levels.screen : 0;
      },
    };
    this.handles.add(handle);
    const cancel = () => {
      void handle.close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await session.connect(connection.url, connection.token);
      if (closed || signal.aborted)
        throw signal.reason ?? new DOMException("Cancelled", "AbortError");
      await session.devices(
        kind === "voice" ? this.devices.input : undefined,
        this.devices.output,
      );
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  bind(container?: HTMLElement) {
    if (this.selected?.element) this.park(this.selected.element);
    this.container = container;
    if (container && this.selected?.element)
      container.replaceChildren(this.selected.element);
  }
  show(raw: unknown) {
    const handle = raw as EsportsBrowserHandle | undefined;
    if (this.selected?.element && this.selected !== handle)
      this.park(this.selected.element);
    this.selected = handle;
    if (handle?.element && this.container)
      this.container.replaceChildren(handle.element);
    else this.container?.replaceChildren();
  }
  private park(element: HTMLVideoElement) {
    if (!this.parking) {
      const parking = document.createElement("div");
      parking.dataset.esportsPrewarm = "";
      Object.assign(parking.style, {
        position: "fixed",
        width: "1px",
        height: "1px",
        left: "0",
        top: "0",
        opacity: "0.01",
        pointerEvents: "none",
        overflow: "hidden",
      });
      document.body.append(parking);
      this.parking = parking;
    }
    this.parking.append(element);
  }
  async microphone(enabled: boolean, deviceId?: string) {
    const voice = this.voice;
    if (enabled && !voice) throw new Error("请先连接席位语音");
    await voice?.microphone(enabled, deviceId);
  }
  async configureMicrophone(
    settings: Pick<
      DesktopSettings,
      "noiseReduction" | "microphoneEffect" | "microphoneReverbStrength"
    >,
  ) {
    await this.voice?.configureMicrophone(
      settings.noiseReduction,
      settings.microphoneEffect ?? "none",
      settings.microphoneReverbStrength,
    );
  }
  async setDevices(input?: string, output?: string) {
    this.devices = { input, output };
    await Promise.all(
      [...this.handles].map((h) =>
        h.session.devices(h.kind === "voice" ? input : undefined, output),
      ),
    );
  }
  voiceVolume(value: number) {
    this.levels.voice = value;
    for (const h of this.handles)
      if (h.kind !== "video") h.session.voiceVolume(value);
  }
  screenVolume(value: number) {
    this.levels.screen = value;
    this.selected?.session.screenVolume(value);
    if (this.selected?.element) this.selected.element.volume = value;
  }
  memberVolumes(value: Record<string, number>, applyExisting = true) {
    this.levels.members = value;
    for (const h of this.handles) h.session.memberVolumes(value, applyExisting);
  }
  memberVolume(userId: string, value: number) {
    this.levels.members[userId] = value;
    for (const h of this.handles) h.session.memberVolume(userId, value);
  }
  setWatchProfile(value: WatchProfile) {
    this.profile = value;
    for (const h of this.handles) h.session.setWatchProfile(value);
  }
  async startAudio() {
    await Promise.all([...this.handles].map((h) => h.session.startAudio()));
  }
  async diagnostics(exclude?: MediaSession) {
    return Promise.all(
      [...this.handles]
        .filter((h) => h.session !== exclude)
        .map(async (h) => ({
          channel: h.channel,
          kind: h.kind,
          media: await h.session.detailedDiagnostics(),
        })),
    );
  }
  async close() {
    await Promise.all([...this.handles].map((h) => h.close()));
    this.parking?.remove();
    this.parking = undefined;
    this.selected = undefined;
  }
}
