import {
  Room,
  LocalAudioTrack,
  RoomEvent,
  Track,
  ConnectionState,
  type DisconnectReason,
  RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type LocalTrackPublication,
} from "livekit-client";
import {
  nativeOwner,
  qualityPresets,
  type Quality,
  type NoiseReduction,
  type RoomControl,
} from "@cinegather/contracts";
import { decodeRoomControl } from "./room-control";
import { MoviePlayback } from "./movie";
import { AudioMixer } from "./mixer";
import { VoicePlayback } from "./voice-playback";
import { ShareSubscriptions } from "./subscriptions";
import { BrowserCapture } from "./browser-capture";
import { boundedStats, diagnosticHash, PlaybackProbe } from "./diagnostics";
import {
  createMicrophoneDenoiser,
  microphoneConstraints,
  type MicrophoneNoiseStatus,
} from "./noise";
export interface ParticipantSummary {
  id: string;
  name: string;
  local: boolean;
  microphone: boolean;
  microphoneAllowed?: boolean;
  speaking: boolean;
  quality: string;
}
export interface MediaSummary {
  revision: number;
  state: string;
  participants: ParticipantSummary[];
  sharer?: { id: string; name: string; local: boolean; hasVideo: boolean };
  audioBlocked: boolean;
  watching: boolean;
  systemAudio: boolean;
  microphoneNoise?: MicrophoneNoiseStatus;
}
export class MediaSession {
  private room?: Room;
  private revision = 0;
  private video?: HTMLVideoElement;
  private videoTrack?: Track;
  private audioElements = new Map<string, HTMLMediaElement[]>();
  private mixer = new AudioMixer();
  private voices: VoicePlayback;
  private movie = new MoviePlayback();
  private movieAudio?: { sid: string; track: RemoteAudioTrack };
  private subscriptions = new ShareSubscriptions();
  private microphoneRevision = 0;
  private microphoneWanted = false;
  private noiseMode: NoiseReduction = "enhanced";
  private noiseStatus?: MicrophoneNoiseStatus;
  private poll?: ReturnType<typeof setInterval>;
  private browserCapture = new BrowserCapture();
  private diagnosticEvents: { name: string; reason?: number }[] = [];
  private diagnosticHashes = new Map<string, Promise<string>>();
  private playbackProbe = new PlaybackProbe();
  private diagnosticReports = new WeakMap<
    Track,
    Promise<RTCStatsReport | undefined>
  >();
  private diagnosticReport(track: Track) {
    let pending = this.diagnosticReports.get(track);
    if (!pending) {
      pending = track
        .getRTCStatsReport()
        .finally(() => this.diagnosticReports.delete(track));
      this.diagnosticReports.set(track, pending);
    }
    return pending;
  }
  private diagnoseEvent(name: string, reason?: number) {
    if (this.diagnosticEvents.length < 64)
      this.diagnosticEvents.push({ name, reason });
  }
  takeDiagnosticEvents() {
    return [
      ...this.diagnosticEvents.splice(0),
      ...this.playbackProbe.takeEvents().map((name) => ({ name })),
    ];
  }
  constructor(
    private readonly changed: (summary: MediaSummary) => void,
    private readonly error: (error: unknown) => void,
    private readonly shareEnded: () => void,
    private readonly disconnected?: (reason?: DisconnectReason) => void,
    private readonly controlled?: (command: RoomControl) => void,
  ) {
    this.voices = new VoicePlayback(() => this.emit(), this.error);
  }
  async connect(url: string, token: string) {
    await this.disconnect();
    const revision = ++this.revision;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      publishDefaults: { videoCodec: "h264", stopMicTrackOnMute: false },
    });
    this.room = room;
    for (const event of [
      RoomEvent.Connected,
      RoomEvent.Reconnecting,
      RoomEvent.SignalReconnecting,
      RoomEvent.Reconnected,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.TrackStreamStateChanged,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackSubscriptionFailed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ConnectionQualityChanged,
    ])
      room.on(event, () => {
        if (this.room === room) this.diagnoseEvent(event);
      });
    room.on(RoomEvent.Disconnected, (reason) =>
      this.diagnoseEvent("disconnected", reason),
    );
    const emit = () => {
      if (this.room === room) this.emit();
    };
    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        pub: RemoteTrackPublication,
        p: RemoteParticipant,
      ) => {
        if (this.room === room) this.attach(track, pub, p);
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
      this.detach(track, pub.trackSid);
      emit();
    });
    room.on(RoomEvent.TrackPublished, emit);
    room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare && pub.track)
        pub.track.mediaStreamTrack.addEventListener(
          "ended",
          () => {
            if (this.room === room) this.shareEnded();
          },
          { once: true },
        );
      emit();
    });
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.AudioPlaybackStatusChanged,
      RoomEvent.ParticipantPermissionsChanged,
    ])
      room.on(event, emit);
    room.on(RoomEvent.ParticipantPermissionsChanged, () => {
      if (this.room !== room) return;
      const permission = room.localParticipant.permissions;
      if (
        permission?.canPublish === false ||
        (permission?.canPublishSources.length &&
          !permission.canPublishSources.includes(2))
      )
        void this.microphone(false).catch(this.error);
    });
    room.on(
      RoomEvent.DataReceived,
      (payload, participant, _kind, topic, _encryption, senderIdentity) => {
        if (this.room !== room || participant) return;
        const command = decodeRoomControl(
          payload,
          topic,
          senderIdentity,
          room.name,
        );
        if (!command) return;
        if (command.action === "mute-microphone")
          void this.microphone(false).catch(this.error);
        this.controlled?.(command);
      },
    );
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.room !== room) return;
      this.clearElements();
      emit();
      this.disconnected?.(reason);
      this.shareEnded();
    });
    room.on(RoomEvent.MediaDevicesError, this.error);
    try {
      // Default-deny avoids receiving any shared media before the viewer opts in,
      // including shares already running when this participant enters the room.
      await room.connect(url, token, { autoSubscribe: false });
      if (revision !== this.revision) {
        await room.disconnect();
        return;
      }
      await room.startAudio().catch(() => {});
      this.poll = setInterval(emit, 1500);
      this.emit();
    } catch (error) {
      if (this.room === room) await this.disconnect();
      throw error;
    }
  }
  private emit() {
    const room = this.room;
    if (!room) {
      this.changed({
        revision: this.revision,
        state: "disconnected",
        participants: [],
        audioBlocked: false,
        watching: false,
        systemAudio: false,
      });
      return;
    }
    const participants = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ];
    this.subscriptions.sync(room);
    const sharer = participants.find((p) =>
      p.getTrackPublication(Track.Source.ScreenShare),
    );
    const publication = sharer?.getTrackPublication(Track.Source.ScreenShare);
    const viewing =
      sharer === room.localParticipant || this.subscriptions.watching;
    const next = viewing ? publication?.track : undefined;
    this.videoTrack = next;
    const filmAudio = viewing
      ? sharer?.getTrackPublication(Track.Source.ScreenShareAudio)?.track
      : undefined;
    this.movie.tracks(
      next,
      filmAudio === this.movieAudio?.track ? this.movieAudio?.track : undefined,
    );
    this.changed({
      revision: this.revision,
      state: room.state,
      participants: participants
        .filter((p) => !nativeOwner(p.identity))
        .map((p) => ({
          id: p.identity,
          name: p.name || "朋友",
          local: p === room.localParticipant,
          microphone: p.isMicrophoneEnabled,
          microphoneAllowed:
            p.permissions?.canPublish !== false &&
            (!p.permissions?.canPublishSources.length ||
              p.permissions.canPublishSources.includes(2)),
          speaking: p.isSpeaking,
          quality: p.connectionQuality,
        })),
      sharer: sharer
        ? {
            id: nativeOwner(sharer.identity) ?? sharer.identity,
            name: sharer.name || "朋友",
            local:
              sharer === room.localParticipant ||
              nativeOwner(sharer.identity) === room.localParticipant.identity,
            hasVideo: Boolean(next),
          }
        : undefined,
      microphoneNoise: this.noiseStatus,
      audioBlocked: !room.canPlaybackAudio || this.voices.blocked,
      watching: this.subscriptions.watching,
      systemAudio: Boolean(
        sharer?.getTrackPublication(Track.Source.ScreenShareAudio),
      ),
    });
  }
  private attach(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    if (
      !this.subscriptions.watching &&
      [Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(
        pub.source,
      )
    ) {
      pub.setSubscribed(false);
      return;
    }
    if (
      track instanceof RemoteAudioTrack &&
      pub.source === Track.Source.ScreenShareAudio &&
      nativeOwner(participant.identity) === this.room?.localParticipant.identity
    ) {
      pub.setSubscribed(false);
      return;
    }
    if (
      track instanceof RemoteAudioTrack &&
      pub.source === Track.Source.ScreenShareAudio
    ) {
      this.movieAudio = { sid: pub.trackSid, track };
      this.mixer.attach(pub.trackSid, participant.identity, "screen", track);
      this.emit();
      return;
    }
    if (track instanceof RemoteAudioTrack) {
      const el = track.attach();
      el.dataset.cinegatherAudio = pub.source;
      el.style.display = "none";
      document.body.append(el);
      this.audioElements.set(pub.trackSid, [el]);
      this.mixer.attach(
        pub.trackSid,
        participant.identity,
        "voice",
        this.voices.attach(
          pub.trackSid,
          el.srcObject as MediaStream,
          el,
          track,
        ),
      );
      void el.play().catch(() => this.emit());
    }
    this.emit();
  }
  private detach(track: Track, sid: string) {
    this.voices.remove(sid);
    if (this.movieAudio?.sid === sid) {
      this.movieAudio = undefined;
      this.movie.tracks(this.videoTrack);
      this.mixer.remove(sid);
      return;
    }
    if (track === this.videoTrack) {
      this.videoTrack = undefined;
      this.movie.tracks(undefined, this.movieAudio?.track);
      return;
    }
    const elements = new Set([
      ...track.detach(),
      ...(this.audioElements.get(sid) ?? []),
    ]);
    for (const element of elements) {
      element.pause();
      element.srcObject = null;
      element.remove();
    }
    this.audioElements.delete(sid);
    this.mixer.remove(sid);
  }
  private clearElements() {
    this.subscriptions.reset();
    this.voices.clear();
    this.movie.tracks();
    this.movieAudio = undefined;
    this.videoTrack = undefined;
    if (this.video) this.video.srcObject = null;
    for (const elements of this.audioElements.values())
      for (const el of elements) el.remove();
    this.audioElements.clear();
    this.mixer.clear();
  }
  setVideoElement(element?: HTMLVideoElement) {
    this.video = element;
    this.playbackProbe.bind(element);
    this.movie.bind(element);
  }
  async microphone(enabled: boolean, deviceId?: string) {
    const room = this.room;
    if (enabled && (!room || room.state !== ConnectionState.Connected))
      throw new Error("请先连接房间");
    const permission = room?.localParticipant.permissions;
    if (
      enabled &&
      (permission?.canPublish === false ||
        (permission?.canPublishSources.length &&
          !permission.canPublishSources.includes(2)))
    )
      throw new Error("房主已禁止你在此房间开麦");
    let revision = ++this.microphoneRevision;
    let wanted = enabled;
    this.microphoneWanted = enabled;
    if (!room) return;
    if (enabled && !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "语音需要使用 HTTPS 或本机地址，并允许 Chrome 使用麦克风",
      );
    while (this.room === room) {
      let publication: LocalTrackPublication | undefined;
      const mode = this.noiseMode;
      try {
        publication = await room.localParticipant.setMicrophoneEnabled(wanted, {
          deviceId: deviceId || undefined,
          ...microphoneConstraints(mode),
        });
        if (wanted && mode !== "enhanced")
          this.noiseStatus = { requested: mode, active: mode };
      } catch (error) {
        if (
          this.room !== room ||
          (revision !== this.microphoneRevision && !this.microphoneWanted)
        )
          return;
        throw error;
      }
      if (this.room !== room) {
        publication?.track?.stop();
        return;
      }
      // The SDK assigns its audio context only after creating the mic track;
      // passing a processor into capture options initialises it too early.
      // Publish with platform suppression, then attach enhancement to that track.
      if (
        wanted &&
        this.microphoneWanted &&
        (mode !== this.noiseMode ||
          (mode === "enhanced" &&
            publication?.track instanceof LocalAudioTrack &&
            !publication.track.getProcessor()))
      )
        await this.noiseReduction(this.noiseMode);
      if (revision === this.microphoneRevision) {
        this.emit();
        return;
      }
      // A pending OS grant or SDK publication can settle after a newer mute.
      // Reapply the latest intent, including when the SDK's pending wait expires.
      revision = this.microphoneRevision;
      wanted = this.microphoneWanted;
    }
  }
  private async createDenoiser(room: Room) {
    return createMicrophoneDenoiser((status) => {
      if (this.room !== room || this.noiseMode !== "enhanced") return;
      this.noiseStatus = status;
      this.emit();
    });
  }
  async noiseReduction(mode: NoiseReduction) {
    this.noiseMode = mode;
    this.noiseStatus = undefined;
    const room = this.room;
    const track = room?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    if (!room || !(track instanceof LocalAudioTrack)) return;
    // These SDK operations retain the existing track's mute/PTT intent.
    await track.applyConstraints(microphoneConstraints(mode));
    if (mode === "enhanced") {
      const processor = await this.createDenoiser(room);
      if (this.room !== room || this.noiseMode !== mode) return;
      if (processor) {
        try {
          await track.setProcessor(processor);
        } catch (error) {
          await processor.destroy();
          if (this.room !== room) return;
          await track.stopProcessor();
          await track.applyConstraints(microphoneConstraints("basic"));
          this.noiseStatus = {
            requested: "enhanced",
            active: "basic",
            reason:
              error instanceof Error
                ? error.message
                : "Noise processor could not be attached",
          };
        }
      } else {
        await track.stopProcessor();
        await track.applyConstraints(microphoneConstraints("basic"));
      }
    } else {
      await track.stopProcessor();
      this.noiseStatus = { requested: mode, active: mode };
    }
    this.emit();
  }
  async share(quality: Quality, systemAudio: boolean) {
    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected)
      throw new Error("媒体未连接");
    const preset = qualityPresets[quality];
    const publication = await room.localParticipant.setScreenShareEnabled(
      true,
      {
        audio: systemAudio
          ? {
              restrictOwnAudio: true,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 2,
            }
          : false,
        systemAudio: systemAudio ? "include" : "exclude",
        selfBrowserSurface: "exclude",
        resolution: {
          width: preset.width,
          height: preset.height,
          frameRate: preset.frameRate,
        },
        contentHint: quality === "game" ? "motion" : "detail",
      },
      {
        screenShareEncoding: {
          maxBitrate: preset.maxBitrate,
          maxFramerate: preset.frameRate,
        },
        videoCodec: "h264",
        simulcast: false,
      },
    );
    if (this.room !== room) {
      publication?.track?.stop();
      await room.localParticipant.setScreenShareEnabled(false);
      return;
    }
    if (
      systemAudio &&
      room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
        ?.track?.mediaStreamTrack.readyState !== "live"
    )
      this.error(
        new Error(
          "本次未采集到系统声音，当前仅共享画面。请检查系统授权和共享来源。",
        ),
      );
    this.emit();
  }
  async stopShare() {
    this.browserCapture.stop();
    if (this.room)
      await this.room.localParticipant.setScreenShareEnabled(false);
    this.emit();
  }
  async publishShareAudio(track: MediaStreamTrack) {
    const room = this.room;
    const video = room?.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.track;
    if (
      !room ||
      room.state !== ConnectionState.Connected ||
      !video ||
      track.readyState !== "live"
    ) {
      track.stop();
      throw new Error("共享已停止，请重新选择画面");
    }
    try {
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.ScreenShareAudio,
        dtx: false,
        red: true,
        forceStereo: true,
      });
      if (
        this.room !== room ||
        room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
          ?.track !== video ||
        track.readyState !== "live"
      ) {
        await room.localParticipant.unpublishTrack(track, true);
        throw new Error("共享已停止");
      }
      this.emit();
    } catch (error) {
      track.stop();
      throw error;
    }
  }
  async selectBrowserShare(quality: Quality, audio: boolean) {
    const selected = await this.browserCapture.select(quality, audio);
    if (selected) {
      const stream = this.browserCapture.current;
      stream?.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (this.browserCapture.current === stream) this.shareEnded();
        },
        { once: true },
      );
    }
    return selected;
  }
  get browserAudioNotice() {
    return this.browserCapture.audioNotice;
  }
  async publishBrowserShare(quality: Quality) {
    const room = this.room;
    const stream = this.browserCapture.current;
    if (
      !room ||
      room.state !== ConnectionState.Connected ||
      !stream ||
      stream.getVideoTracks()[0]?.readyState !== "live"
    )
      throw new Error("共享已取消，请重新选择画面");
    const preset = qualityPresets[quality];
    const results = await Promise.allSettled(
      stream.getTracks().map((track) =>
        room.localParticipant.publishTrack(track, {
          source:
            track.kind === "video"
              ? Track.Source.ScreenShare
              : Track.Source.ScreenShareAudio,
          screenShareEncoding: {
            maxBitrate: preset.maxBitrate,
            maxFramerate: preset.frameRate,
          },
          videoCodec: "h264",
          simulcast: false,
        }),
      ),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (
      failed ||
      this.room !== room ||
      this.browserCapture.current !== stream
    ) {
      stream.getTracks().forEach((track) => track.stop());
      await Promise.allSettled(
        stream
          .getTracks()
          .map((track) => room.localParticipant.unpublishTrack(track, true)),
      );
      if (failed?.status === "rejected") throw failed.reason;
      return;
    }
    this.emit();
  }
  voiceVolume(volume: number) {
    this.mixer.voice(volume);
  }
  screenVolume(volume: number) {
    this.mixer.screen(volume);
  }
  memberVolume(userId: string, volume: number) {
    this.mixer.member(userId, volume);
  }
  watch(enabled: boolean) {
    this.subscriptions.watch(enabled);
    this.emit();
  }
  async devices(input?: string, output?: string) {
    if (!this.room) return;
    if (input !== undefined)
      await this.room.switchActiveDevice("audioinput", input || "default");
    if (
      output !== undefined &&
      typeof HTMLMediaElement.prototype.setSinkId === "function"
    )
      await this.room.switchActiveDevice("audiooutput", output || "default");
  }
  async startAudio() {
    await Promise.all([this.room?.startAudio(), this.voices.resume()]);
    this.emit();
  }
  async diagnostics() {
    const detail = await this.detailedDiagnostics();
    return {
      state: detail.state,
      microphoneNoise: detail.microphoneNoise,
      watching: detail.watching,
      capturedAt: new Date().toISOString(),
      tracks: detail.tracks
        .flatMap((track) =>
          track.stats.map((stat) => ({
            ...stat,
            source: track.source,
            local: track.local,
          })),
        )
        .slice(0, 200),
    };
  }
  async detailedDiagnostics() {
    const room = this.room;
    const tracks = room
      ? [room.localParticipant, ...room.remoteParticipants.values()].flatMap(
          (p) => [...p.trackPublications.values()].map((pub) => ({ p, pub })),
        )
      : [];
    const reports = await Promise.all(
      tracks
        .sort(
          (a, b) =>
            Number(b.pub.kind === "video") - Number(a.pub.kind === "video"),
        )
        .slice(0, 40)
        .map(async ({ p, pub }) => {
          let participant = this.diagnosticHashes.get(p.identity);
          if (!participant) {
            participant = diagnosticHash(p.identity);
            this.diagnosticHashes.set(p.identity, participant);
          }
          return {
            track: pub.trackSid,
            participant: await participant,
            source: pub.source,
            local: p === room?.localParticipant,
            kind: pub.kind,
            muted: pub.isMuted,
            subscribed: pub.isSubscribed,
            streamState: pub.track?.streamState,
            settings: pub.track?.mediaStreamTrack.getSettings(),
            videoQuality:
              "videoQuality" in pub
                ? (pub as RemoteTrackPublication).videoQuality
                : undefined,
            enabled:
              "isEnabled" in pub
                ? (pub as RemoteTrackPublication).isEnabled
                : undefined,
            ...(pub.track
              ? await boundedStats(() => this.diagnosticReport(pub.track!))
              : { status: "unavailable" as const, stats: [] }),
          };
        }),
    );
    return {
      state: room?.state ?? "disconnected",
      watching: this.subscriptions.watching,
      microphoneNoise: this.noiseStatus
        ? {
            requested: this.noiseStatus.requested,
            active: this.noiseStatus.active,
            fallback: Boolean(this.noiseStatus.reason),
          }
        : undefined,
      tracks: reports,
      playback: this.playbackProbe.sample(),
    };
  }
  async disconnect() {
    if (this.room) this.diagnoseEvent("local-disconnect");
    this.diagnosticHashes.clear();
    this.subscriptions.reset();
    this.browserCapture.stop();
    ++this.revision;
    ++this.microphoneRevision;
    this.microphoneWanted = false;
    this.noiseStatus = undefined;
    clearInterval(this.poll);
    this.poll = undefined;
    const room = this.room;
    this.room = undefined;
    if (room) {
      room.removeAllListeners();
      await room.disconnect(true);
    }
    this.clearElements();
    this.emit();
  }
}
