import {
  Room,
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
} from "@cinegather/contracts";
import { MoviePlayback } from "./movie";
import { AudioMixer } from "./mixer";
import { BrowserCapture } from "./browser-capture";
export interface ParticipantSummary {
  id: string;
  name: string;
  local: boolean;
  microphone: boolean;
  speaking: boolean;
  quality: string;
}
export interface MediaSummary {
  revision: number;
  state: string;
  participants: ParticipantSummary[];
  sharer?: { id: string; name: string; local: boolean };
  audioBlocked: boolean;
  systemAudio: boolean;
}
export class MediaSession {
  private room?: Room;
  private revision = 0;
  private video?: HTMLVideoElement;
  private videoTrack?: Track;
  private audioElements = new Map<string, HTMLMediaElement[]>();
  private mixer = new AudioMixer();
  private movie = new MoviePlayback();
  private movieAudio?: { sid: string; track: RemoteAudioTrack };
  private watching = true;
  private microphoneRevision = 0;
  private microphoneWanted = false;
  private poll?: ReturnType<typeof setInterval>;
  private browserCapture = new BrowserCapture();
  constructor(
    private readonly changed: (summary: MediaSummary) => void,
    private readonly error: (error: unknown) => void,
    private readonly shareEnded: () => void,
    private readonly disconnected?: (reason?: DisconnectReason) => void,
  ) {}
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
    room.on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication) => {
      if (
        !this.watching &&
        [Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(
          publication.source,
        )
      )
        publication.setSubscribed(false);
      emit();
    });
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
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.room !== room) return;
      this.clearElements();
      emit();
      this.disconnected?.(reason);
      this.shareEnded();
    });
    room.on(RoomEvent.MediaDevicesError, this.error);
    try {
      await room.connect(url, token, { autoSubscribe: true });
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
        systemAudio: false,
      });
      return;
    }
    const participants = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ];
    const sharer = participants.find((p) =>
      p.getTrackPublication(Track.Source.ScreenShare),
    );
    const publication = sharer?.getTrackPublication(Track.Source.ScreenShare);
    const next = publication?.track;
    this.videoTrack = next;
    const filmAudio = sharer?.getTrackPublication(
      Track.Source.ScreenShareAudio,
    )?.track;
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
          }
        : undefined,
      audioBlocked: !room.canPlaybackAudio,
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
      !this.watching &&
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
        pub.source === Track.Source.ScreenShareAudio ? "screen" : "voice",
        track,
      );
      void el.play().catch(() => this.emit());
    }
    this.emit();
  }
  private detach(track: Track, sid: string) {
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
    this.movie.bind(element);
  }
  async microphone(enabled: boolean, deviceId?: string) {
    const room = this.room;
    if (enabled && (!room || room.state !== ConnectionState.Connected))
      throw new Error("请先连接房间");
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
      try {
        publication = await room.localParticipant.setMicrophoneEnabled(wanted, {
          deviceId: deviceId || undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
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
    this.watching = enabled;
    for (const p of this.room?.remoteParticipants.values() ?? [])
      for (const pub of p.trackPublications.values())
        if (
          pub.source === Track.Source.ScreenShare ||
          pub.source === Track.Source.ScreenShareAudio
        )
          pub.setSubscribed(enabled);
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
    await this.room?.startAudio();
    this.emit();
  }
  async diagnostics() {
    const tracks: Record<string, unknown>[] = [];
    for (const p of this.room
      ? [this.room.localParticipant, ...this.room.remoteParticipants.values()]
      : []) {
      for (const pub of p.trackPublications.values()) {
        const track = pub.track;
        if (!track) continue;
        const report = await track.getRTCStatsReport();
        report?.forEach((stat) => {
          if (
            ["inbound-rtp", "outbound-rtp", "candidate-pair", "codec"].includes(
              stat.type,
            )
          ) {
            const safe: Record<string, unknown> = {
              type: stat.type,
              source: pub.source,
              local: p === this.room?.localParticipant,
            };
            for (const key of [
              "kind",
              "bytesReceived",
              "bytesSent",
              "packetsLost",
              "jitter",
              "framesPerSecond",
              "framesDecoded",
              "framesDropped",
              "frameWidth",
              "frameHeight",
              "currentRoundTripTime",
              "availableOutgoingBitrate",
              "mimeType",
              "state",
              "nominated",
              "nackCount",
              "retransmittedPacketsSent",
            ])
              if (stat[key] !== undefined) safe[key] = stat[key];
            if (stat.type === "candidate-pair") {
              const candidate = report.get(stat.localCandidateId);
              if (candidate) {
                safe.localCandidateType = candidate.candidateType;
                safe.transportProtocol = candidate.protocol;
              }
              const remote = report.get(stat.remoteCandidateId);
              if (remote) safe.remoteCandidateType = remote.candidateType;
            }
            tracks.push(safe);
          }
        });
      }
    }
    return {
      state: this.room?.state ?? "disconnected",
      watching: this.watching,
      tracks,
      capturedAt: new Date().toISOString(),
    };
  }
  async disconnect() {
    this.browserCapture.stop();
    ++this.revision;
    ++this.microphoneRevision;
    this.microphoneWanted = false;
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
