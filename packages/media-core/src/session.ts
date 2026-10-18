import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type LocalTrackPublication,
} from "livekit-client";
import { qualityPresets, type Quality } from "@cinegather/contracts";
import { AudioMixer } from "./mixer";
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
  private watching = true;
  private poll?: ReturnType<typeof setInterval>;
  constructor(
    private readonly changed: (summary: MediaSummary) => void,
    private readonly error: (error: unknown) => void,
    private readonly shareEnded: () => void,
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
    room.on(RoomEvent.Disconnected, () => {
      this.clearElements();
      emit();
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
    if (next !== this.videoTrack) {
      if (this.video && this.videoTrack) this.videoTrack.detach(this.video);
      this.videoTrack = next;
      if (this.video && next) {
        next.attach(this.video);
        this.video.muted = true;
        void this.video.play().catch(() => {});
      }
    }
    this.changed({
      revision: this.revision,
      state: room.state,
      participants: participants.map((p) => ({
        id: p.identity,
        name: p.name || "朋友",
        local: p === room.localParticipant,
        microphone: p.isMicrophoneEnabled,
        speaking: p.isSpeaking,
        quality: p.connectionQuality,
      })),
      sharer: sharer
        ? {
            id: sharer.identity,
            name: sharer.name || "朋友",
            local: sharer === room.localParticipant,
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
    this.videoTrack?.detach();
    this.videoTrack = undefined;
    if (this.video) this.video.srcObject = null;
    for (const elements of this.audioElements.values())
      for (const el of elements) el.remove();
    this.audioElements.clear();
    this.mixer.clear();
  }
  setVideoElement(element?: HTMLVideoElement) {
    if (this.video && this.videoTrack) this.videoTrack.detach(this.video);
    this.video = element;
    if (element && this.videoTrack) {
      this.videoTrack.attach(element);
      element.muted = true;
      void element.play().catch(() => {});
    }
  }
  async microphone(enabled: boolean, deviceId?: string) {
    if (!this.room || this.room.state !== ConnectionState.Connected)
      throw new Error("请先连接房间");
    await this.room.localParticipant.setMicrophoneEnabled(enabled, {
      deviceId: deviceId || undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
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
        audio: systemAudio,
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
      !room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
    )
      this.error(
        new Error(
          "本次未采集到系统声音，当前仅共享画面。请检查系统授权和共享来源。",
        ),
      );
    this.emit();
  }
  async stopShare() {
    if (this.room)
      await this.room.localParticipant.setScreenShareEnabled(false);
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
    if (input) await this.room.switchActiveDevice("audioinput", input);
    if (output) await this.room.switchActiveDevice("audiooutput", output);
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
    ++this.revision;
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
