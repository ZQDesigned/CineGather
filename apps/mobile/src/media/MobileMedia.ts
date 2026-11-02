import {
  EsportsCoordinator,
  EsportsPrewarmTimeout,
  FirstVideoFrame,
  type MobileApi,
  type EsportsClientState,
  type EsportsMediaHandle,
} from "@cinegather/client-core";
import {
  esportsSnapshotSchema,
  esportsConnectionSchema,
  esportsChannelName,
  type RoomInfo,
} from "@cinegather/contracts";
import { NativeMedia, type MediaSnapshot } from "./NativeMedia";
type Events = ConstructorParameters<typeof NativeMedia>[0];
type Kind = "voice" | "video" | "monitor";
interface NativeSlot extends EsportsMediaHandle {
  native: NativeMedia;
  kind: Kind;
  channel: string;
  audible: boolean;
  frame: FirstVideoFrame;
}
// One parent owns the platform audio session and room lifecycle. Child channels
// reuse it; closing a warming video must never stop ongoing room audio.
export class MobileMedia {
  readonly standard: NativeMedia;
  readonly coordinator: EsportsCoordinator;
  private roomId?: string;
  private handles = new Set<NativeSlot>();
  private selected?: NativeSlot;
  private listeners = new Set<() => void>();
  private current: MediaSnapshot;
  private foreground = true;
  private viewActive = true;
  private voiceGain = 1;
  private shareGain = 1;
  private gains = new Map<string, number>();
  private polling = false;
  constructor(
    private api: MobileApi,
    private events: Events,
    private changed: (state: EsportsClientState | undefined) => void,
  ) {
    this.standard = new NativeMedia({
      ...events,
      microphoneMuted: () => this.voice()?.safetyMute(),
    });
    this.current = this.standard.snapshot();
    this.standard.subscribe(() => this.update());
    this.coordinator = new EsportsCoordinator({
      api: {
        connection: async (channel, seatRevision, watchRevision) =>
          esportsConnectionSchema.parse(
            await this.api.call("esports-connect", (c) =>
              c.POST("/api/v1/rooms/{roomId}/esports/connection", {
                params: { path: { roomId: this.roomId! } },
                body: { channel, seatRevision, watchRevision },
              }),
            ),
          ),
        watch: async (body) =>
          esportsSnapshotSchema.parse(
            await this.api.call("esports-watch", (c) =>
              c.POST("/api/v1/rooms/{roomId}/esports/watch", {
                params: { path: { roomId: this.roomId! } },
                body,
              }),
            ),
          ),
        monitor: async (body) =>
          esportsSnapshotSchema.parse(
            await this.api.call("esports-monitor", (c) =>
              c.POST("/api/v1/rooms/{roomId}/esports/monitor", {
                params: { path: { roomId: this.roomId! } },
                body,
              }),
            ),
          ),
      },
      media: {
        open: (connection, kind, signal) => this.open(connection, kind, signal),
        show: (handle) => {
          this.selected = handle as NativeSlot | undefined;
          this.update();
        },
        muteMicrophone: async () => {
          this.voice()?.safetyMute();
        },
      },
      changed: (state) => {
        this.changed(state.snapshot ? state : undefined);
        this.update();
      },
      error: (error) => {
        if (error instanceof EsportsPrewarmTimeout)
          this.events.error(
            new Error("新画面暂未就绪，已保留当前画面，请稍后重试"),
          );
        else this.events.error(error);
      },
    });
  }
  snapshot = () => this.current;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private voice() {
    return [...this.handles].find((h) => h.kind === "voice")?.native;
  }
  private update() {
    const s = this.coordinator?.state.snapshot;
    if (!this.roomId || !s) this.current = this.standard.snapshot();
    else {
      const voice = this.voice()?.snapshot(),
        monitor = [...this.handles]
          .find((h) => h.kind === "monitor")
          ?.native.snapshot(),
        view = this.selected?.native.snapshot();
      const warm = [...this.handles]
        .find(
          (h) =>
            h.kind === "video" &&
            h.channel ===
              esportsChannelName(s.roomId, {
                kind: "video",
                publicationId:
                  this.coordinator.state.warming ??
                  "00000000-0000-4000-8000-000000000000",
              }),
        )
        ?.native.snapshot();
      const peers = [...(voice?.members ?? []), ...(monitor?.members ?? [])];
      this.current = {
        ...this.standard.snapshot(),
        microphone: voice?.microphone ?? false,
        microphoneAllowed: s.self.microphoneAllowed,
        watching: !!this.coordinator.state.watching,
        foreground: this.foreground && this.viewActive,
        video: view?.video,
        warmingVideo: warm?.video,
        sharer: view?.sharer,
        members: s.members
          .filter((m) => m.online)
          .map((m) => {
            const sound = peers.find((p) => p.id === m.userId);
            return {
              id: m.userId,
              name: m.displayName,
              microphone: sound?.microphone ?? false,
              speaking: sound?.speaking ?? false,
              accompaniment: false,
            };
          }),
      };
    }
    for (const fn of this.listeners) fn();
  }
  private async open(
    connection: { channel: string; url: string; token: string },
    kind: Kind,
    signal: AbortSignal,
  ): Promise<NativeSlot> {
    let closed = false;
    const native = new NativeMedia(
      {
        message: () => {},
        roomChanged: () => {},
        disconnected: () => {
          if (!closed) void this.refreshEsports().catch(this.events.error);
        },
        error: this.events.error,
        ...(kind === "voice"
          ? { foregroundService: this.events.foregroundService }
          : {}),
      },
      { manageAudioSession: false, adaptiveStream: kind !== "video" },
    );
    native.setGain("voice", 0);
    native.setGain("share", 0);
    for (const [id, gain] of this.gains) native.setMemberGain(id, gain);
    const frame = new FirstVideoFrame(
      () => native.snapshot().video?.publication.trackSid,
    );
    const slot: NativeSlot = {
      native,
      kind,
      channel: connection.channel,
      audible: false,
      frame,
      connected: () => !closed && native.isConnected(),
      ready: async (signal) => {
        let stopped = false,
          busy = false;
        const probe = async () => {
          if (stopped || busy) return;
          busy = true;
          try {
            const video = native.snapshot().video;
            if (video?.publication.track) {
              const report = await video.publication.track.getRTCStatsReport();
              if (report)
                frame.stats(video.publication.trackSid, report.values());
            }
          } catch {
            /* Native first-frame event remains available. */
          } finally {
            busy = false;
          }
        };
        const timer = setInterval(() => void probe(), 100);
        void probe();
        try {
          await frame.wait(signal);
        } finally {
          stopped = true;
          clearInterval(timer);
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        frame.close();
        this.handles.delete(slot);
        unsubscribe();
        await native.disconnect();
        this.update();
      },
      video: (active) => native.setForeground(active),
      audio: (active) => {
        slot.audible = active;
        native.setGain("voice", active ? this.voiceGain : 0);
        native.setGain("share", active ? this.shareGain : 0);
      },
    };
    const unsubscribe = native.subscribe(() => {
      if (closed) return;
      const s = native.snapshot();
      if (kind === "video" && s.sharer && !s.watching) {
        native.watch(true);
        return;
      }
      this.update();
    });
    this.handles.add(slot);
    const cancel = () => {
      void slot.close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await native.connect(connection.url, connection.token);
      if (signal.aborted || closed)
        throw signal.reason ?? new Error("连接已取消");
      return slot;
    } catch (error) {
      await slot.close();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  acknowledgeFrame(trackSid: string, width: number, height: number) {
    for (const h of this.handles)
      if (h.kind === "video") h.frame.rendered(trackSid, width, height);
  }
  async connect(url: string, token: string, room?: RoomInfo) {
    await this.disconnect();
    this.roomId = room?.mode === "esports" ? room.id : undefined;
    await this.standard.connect(url, token);
    this.foreground = this.standard.snapshot().foreground;
    if (this.roomId) {
      const snapshot = await this.readEsports();
      if (snapshot.self.seat.kind !== "audience")
        throw new Error("手机版当前仅支持观众席，请使用桌面端进入其他席位");
      await this.coordinator.start(snapshot);
      await this.coordinator.setVisible(this.foreground && this.viewActive);
    }
    this.update();
  }
  private async readEsports() {
    return esportsSnapshotSchema.parse(
      await this.api.call("esports-snapshot", (c) =>
        c.GET("/api/v1/rooms/{roomId}/esports", {
          params: { path: { roomId: this.roomId! } },
        }),
      ),
    );
  }
  async refreshEsports() {
    if (!this.roomId || this.polling) return;
    this.polling = true;
    const roomId = this.roomId;
    try {
      const snapshot = await this.readEsports();
      if (roomId === this.roomId) await this.coordinator.sync(snapshot);
    } finally {
      this.polling = false;
    }
  }
  async disconnect() {
    await this.coordinator?.stop();
    await Promise.all([...this.handles].map((h) => h.close()));
    this.selected = undefined;
    this.roomId = undefined;
    await this.standard.disconnect();
    this.changed(undefined);
    this.update();
  }
  setForeground(active: boolean) {
    this.foreground = active;
    this.standard.setForeground(active);
    if (this.roomId) {
      for (const h of this.handles)
        if (h.kind !== "video") h.native.setForeground(active);
      void this.coordinator
        .setVisible(active && this.viewActive)
        .catch(this.events.error);
    }
    this.update();
  }
  setViewActive(active: boolean) {
    this.viewActive = active;
    if (this.roomId)
      void this.coordinator
        .setVisible(active && this.foreground)
        .catch(this.events.error);
  }
  watch(enabled: boolean) {
    if (this.roomId) {
      if (!enabled)
        void this.coordinator.stopWatching().catch(this.events.error);
    } else this.standard.watch(enabled);
  }
  setAllowed(allowed: boolean) {
    (this.roomId ? this.voice() : this.standard)?.setAllowed(allowed);
  }
  safetyMute() {
    (this.roomId ? this.voice() : this.standard)?.safetyMute();
  }
  interrupt(interrupted: boolean) {
    (this.roomId ? this.voice() : this.standard)?.interrupt(interrupted);
  }
  async toggleMicrophone() {
    const target = this.roomId ? this.voice() : this.standard;
    if (!target) throw new Error("请等待语音连接完成");
    await target.toggleMicrophone();
  }
  gain(kind: "voice" | "share") {
    return this.roomId
      ? kind === "voice"
        ? this.voiceGain
        : this.shareGain
      : this.standard.gain(kind);
  }
  setGain(kind: "voice" | "share", value: number) {
    if (kind === "voice") this.voiceGain = value;
    else this.shareGain = value;
    this.standard.setGain(kind, value);
    if (this.roomId)
      for (const h of this.handles)
        h.native.setGain(kind, h.audible ? value : 0);
  }
  memberGain(id: string) {
    return this.roomId
      ? (this.gains.get(id) ?? 1)
      : this.standard.memberGain(id);
  }
  setMemberGain(id: string, gain: number, initialOnly = false) {
    this.standard.setMemberGain(id, gain, initialOnly);
    if (initialOnly && this.gains.has(id)) return;
    this.gains.set(id, gain);
    for (const h of this.handles) h.native.setMemberGain(id, gain, initialOnly);
  }
  resetMemberGains() {
    this.gains.clear();
    this.standard.resetMemberGains();
    for (const h of this.handles) h.native.resetMemberGains();
  }
  outputs() {
    return this.standard.outputs();
  }
  selectOutput(output: string) {
    return this.standard.selectOutput(output);
  }
  async diagnostics() {
    const base = await this.standard.diagnostics();
    return this.roomId
      ? {
          ...base,
          esports: this.coordinator.diagnostics(),
          channels: await Promise.all(
            [...this.handles].map(async (h) => ({
              kind: h.kind,
              channel: h.channel,
              media: await h.native.diagnostics(),
            })),
          ),
        }
      : base;
  }
}
