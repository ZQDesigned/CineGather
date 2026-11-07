import { createApi, unwrap } from "@cinegather/api-client";
import {
  EsportsCoordinator,
  EsportsPrewarmTimeout,
} from "@cinegather/client-core";
import {
  EsportsBrowserMedia,
  MediaSession,
  type MediaSummary,
} from "@cinegather/media-core";
import {
  esportsChannelName,
  esportsOwnVoice,
  type EsportsConfiguration,
  type CoachVoiceMode,
  esportsDiagnosticSchema,
  type EsportsSeat,
  type EsportsSnapshot,
} from "@cinegather/contracts";
import { state, update } from "../../store";
export class EsportsRuntime {
  roomId?: string;
  publisher?: MediaSession;
  readonly browser: EsportsBrowserMedia;
  readonly coordinator: EsportsCoordinator;
  private summaries = new Map<string, MediaSummary>();
  private control?: MediaSummary;
  private polling = false;
  private viewVisible = true;
  private windowVisible = true;
  constructor(
    private api: ReturnType<typeof createApi>,
    private callbacks: {
      error(error: unknown): void;
      stopShare(): Promise<void>;
      inputLost(): void;
    },
  ) {
    this.browser = new EsportsBrowserMedia({
      changed: (summary, _kind, channel) => {
        this.summaries.set(channel, summary);
        this.emit();
      },
      error: callbacks.error,
      inputLost: callbacks.inputLost,
      controlled: (command) => {
        if (command.action === "mute-microphone")
          void this.browser.microphone(false).catch(callbacks.error);
      },
      disconnected: () => {
        void this.poll().catch(callbacks.error);
      },
    });
    this.coordinator = new EsportsCoordinator({
      api: {
        connection: async (channel, seatRevision, watchRevision) =>
          unwrap(
            await api.POST("/api/v1/rooms/{roomId}/esports/connection", {
              params: { path: { roomId: this.roomId! } },
              body: { channel, seatRevision, watchRevision },
            }),
          ),
        watch: async (body) =>
          unwrap(
            await api.POST("/api/v1/rooms/{roomId}/esports/watch", {
              params: { path: { roomId: this.roomId! } },
              body,
            }),
          ),
        monitor: async (body) =>
          unwrap(
            await api.POST("/api/v1/rooms/{roomId}/esports/monitor", {
              params: { path: { roomId: this.roomId! } },
              body,
            }),
          ),
      },
      media: {
        open: (connection, kind, signal) =>
          this.browser.open(connection, kind, signal),
        show: (handle) => this.browser.show(handle),
        muteMicrophone: () => this.browser.microphone(false),
      },
      changed: (esports) => {
        update({ esports: esports.snapshot ? esports : undefined });
        this.emit();
      },
      error: (error) => {
        if (error instanceof EsportsPrewarmTimeout)
          update({
            warningTitle: "画面暂未就绪",
            warning: "已保留当前画面，可以稍后重新选择。",
          });
        else callbacks.error(error);
      },
    });
  }
  controlChanged(summary: MediaSummary) {
    this.control = summary;
    this.emit();
  }
  private emit() {
    if (!this.roomId) return;
    const current = this.coordinator.state,
      s = current.snapshot;
    if (!s) {
      if (this.control) update({ media: this.control });
      return;
    }
    const own = esportsChannelName(s.roomId, esportsOwnVoice(s.self.seat));
    const voice = this.summaries.get(own);
    const monitor = s.watch.monitorTeam
      ? this.summaries.get(
          esportsChannelName(s.roomId, {
            kind: "team",
            team: s.watch.monitorTeam,
          }),
        )
      : undefined;
    const video = current.watching
      ? this.summaries.get(
          esportsChannelName(s.roomId, {
            kind: "video",
            publicationId: current.watching,
          }),
        )
      : undefined;
    const peers = [
      ...(voice?.participants ?? []),
      ...(monitor?.participants ?? []),
    ];
    const localShare = this.publisherSummary?.sharer;
    update({
      media: {
        ...(video ?? voice ?? this.control ?? state().media),
        state: this.control?.state ?? "connected",
        revision: s.self.revision,
        participants: s.members
          .filter((p) => p.online)
          .map((p) => {
            const sound = peers.find((v) => v.id === p.userId);
            return {
              id: p.userId,
              name: p.displayName,
              local: p.userId === s.self.userId,
              microphone: sound?.microphone ?? false,
              microphoneAllowed: p.microphoneAllowed,
              speaking: sound?.speaking ?? false,
              quality: sound?.quality ?? "unknown",
            };
          }),
        sharer: s.self.seat.kind === "player" ? localShare : video?.sharer,
        watching: !!current.watching,
        videoPaused: video?.videoPaused,
        systemAudio:
          s.self.seat.kind === "player"
            ? (this.publisherSummary?.systemAudio ?? false)
            : (video?.systemAudio ?? false),
        microphoneNoise: voice?.microphoneNoise,
        microphoneEffect: voice?.microphoneEffect,
      },
    });
  }
  private publisherSummary?: MediaSummary;
  async enter(roomId: string) {
    this.roomId = roomId;
    this.summaries.clear();
    this.publisherSummary = undefined;
    this.browser.voiceVolume(state().voiceVolume);
    this.browser.screenVolume(state().screenVolume);
    this.browser.memberVolumes(
      Object.fromEntries(
        Object.entries(state().memberVolumes).map(([id, volume]) => [
          id,
          volume / 100,
        ]),
      ),
    );
    this.browser.setWatchProfile(state().settings.watchProfile ?? "balanced");
    await this.browser.setDevices(
      state().settings.inputDevice,
      state().settings.outputDevice,
    );
    const snapshot = await this.load();
    await this.coordinator.start(snapshot);
    await this.browser.configureMicrophone(state().settings);
  }
  async load() {
    return unwrap(
      await this.api.GET("/api/v1/rooms/{roomId}/esports", {
        params: { path: { roomId: this.roomId! } },
      }),
    );
  }
  async poll() {
    if (!this.roomId || this.polling) return;
    this.polling = true;
    const roomId = this.roomId;
    try {
      const snapshot = await this.load();
      if (this.roomId !== roomId) return;
      const seatChanged =
        snapshot.self.revision !==
        this.coordinator.state.snapshot?.self.revision;
      if (seatChanged) {
        await this.callbacks.stopShare();
        await this.stopPublisher();
      }
      const before = this.coordinator.state.snapshot?.self.revision;
      await this.coordinator.sync(snapshot);
      if (before !== snapshot.self.revision)
        await this.browser.configureMicrophone(state().settings);
    } finally {
      this.polling = false;
    }
  }
  async assign(userId: string, seat: EsportsSeat) {
    const next = unwrap(
      await this.api.POST(
        "/api/v1/rooms/{roomId}/esports/members/{userId}/seat",
        { params: { path: { roomId: this.roomId!, userId } }, body: seat },
      ),
    );
    await this.apply(next);
  }
  async settings(
    name: string,
    configuration: EsportsConfiguration,
    revision: number,
  ) {
    await this.apply(
      unwrap(
        await this.api.PATCH("/api/v1/rooms/{roomId}/esports/settings", {
          params: { path: { roomId: this.roomId! } },
          body: { name, configuration, revision },
        }),
      ),
    );
  }
  async tacticalPause(active: boolean) {
    await this.apply(
      unwrap(
        await this.api.POST("/api/v1/rooms/{roomId}/esports/tactical-pause", {
          params: { path: { roomId: this.roomId! } },
          body: { active },
        }),
      ),
    );
  }
  async coachVoice(mode: CoachVoiceMode) {
    await this.apply(
      unwrap(
        await this.api.POST("/api/v1/rooms/{roomId}/esports/coach-voice", {
          params: { path: { roomId: this.roomId! } },
          body: { mode },
        }),
      ),
    );
  }
  private async apply(next: EsportsSnapshot) {
    if (next.roomId !== this.roomId) return;
    const changed =
      next.self.revision !== this.coordinator.state.snapshot?.self.revision;
    if (changed) {
      await this.callbacks.stopShare();
      await this.stopPublisher();
    }
    await this.coordinator.sync(next);
    if (changed) await this.browser.configureMicrophone(state().settings);
  }
  async preparePublisher(publicationId: string) {
    await this.stopPublisher();
    const snapshot = this.coordinator.state.snapshot;
    if (!snapshot || snapshot.self.seat.kind !== "player")
      throw new Error("当前席位无法共享");
    const connection = unwrap(
      await this.api.POST("/api/v1/rooms/{roomId}/esports/connection", {
        params: { path: { roomId: this.roomId! } },
        body: {
          channel: { kind: "video", publicationId },
          seatRevision: snapshot.self.revision,
        },
      }),
    );
    const session = new MediaSession(
      (summary) => {
        this.publisherSummary = summary;
        this.emit();
      },
      this.callbacks.error,
      () => {
        void this.callbacks.stopShare().catch(this.callbacks.error);
      },
    );
    this.publisher = session;
    await session.connect(connection.url, connection.token);
  }
  async stopPublisher() {
    const publisher = this.publisher;
    this.publisher = undefined;
    await publisher?.disconnect();
    this.publisherSummary = undefined;
    this.emit();
  }
  async disconnect() {
    await this.coordinator.stop();
    await this.browser.close();
    await this.stopPublisher();
    this.roomId = undefined;
    this.control = undefined;
    this.summaries.clear();
    update({ esports: undefined });
  }
  async setVideoVisible(visible: boolean) {
    this.windowVisible = visible;
    await this.coordinator.setVisible(visible && this.viewVisible);
  }
  async setViewActive(visible: boolean) {
    this.viewVisible = visible;
    await this.coordinator.setVisible(visible && this.windowVisible);
  }
  async diagnostics() {
    if (!this.roomId) return undefined;
    return {
      context: esportsDiagnosticSchema.parse(this.coordinator.diagnostics()),
      channels: await this.browser.diagnostics(this.diagnosticMedia),
    };
  }
  get diagnosticMedia() {
    return this.publisher ?? this.browser.viewing ?? this.browser.voice;
  }
  get selectedMedia() {
    return this.browser.viewing;
  }
}
