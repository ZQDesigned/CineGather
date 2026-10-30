import { KtvReverb } from "./ktv-reverb";
import {
  createMicrophoneProcessor,
  type MicrophoneEffectStatus,
} from "./microphone-processor";
import {
  Room,
  LocalAudioTrack,
  createLocalAudioTrack,
  RoomEvent,
  TrackEvent,
  Track,
  ConnectionState,
  type DisconnectReason,
  RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type LocalTrackPublication,
  type LocalVideoTrack,
} from "livekit-client";
import {
  nativeOwner,
  participantOwner,
  type DiagnosticIssue,
  type MediaDiagnostic,
  qualityPresets,
  defaultMicrophoneReverbStrength,
  type Quality,
  type NoiseReduction,
  type MicrophoneEffect,
  type RoomControl,
} from "@cinegather/contracts";
import { decodeRoomChat } from "./chat-events";
import type { ChatMessage } from "@cinegather/contracts";
import { decodeRoomControl } from "./room-control";
import {
  ACCOMPANIMENT_TRACK,
  isAccompaniment,
  voicePublication,
} from "./audio-publications";
import { MoviePlayback } from "./movie";
import { AudioMixer } from "./mixer";
import { VoiceActivity } from "./voice-activity";
import { VoicePlayback } from "./voice-playback";
import { ShareSubscriptions } from "./subscriptions";
import { BrowserCapture } from "./browser-capture";
import { boundedStats, diagnosticHash, PlaybackProbe } from "./diagnostics";
import { senderDiagnostics, videoCapabilities } from "./encoder-diagnostics";
import {
  WatchPlaybackPolicy,
  WatchHealth,
  type WatchAdvice,
} from "./watch-profile";
import { watchProfiles, type WatchProfile } from "@cinegather/contracts";
import { microphoneConstraints, type MicrophoneNoiseStatus } from "./noise";
export interface ParticipantSummary {
  id: string;
  name: string;
  local: boolean;
  microphone: boolean;
  microphoneAllowed?: boolean;
  accompaniment?: boolean;
  speaking: boolean;
  quality: string;
}
export interface MediaSummary {
  watchProfile?: WatchProfile;
  watchBuffering?: boolean;
  watchAdvice?: WatchAdvice;
  revision: number;
  state: string;
  participants: ParticipantSummary[];
  sharer?: { id: string; name: string; local: boolean; hasVideo: boolean };
  audioBlocked: boolean;
  watching: boolean;
  videoPaused?: boolean;
  systemAudio: boolean;
  microphoneNoise?: MicrophoneNoiseStatus;
  microphoneEffect?: MicrophoneEffectStatus;
}
export class MediaSession {
  private watchPolicy = new WatchPlaybackPolicy();
  private watchHealth = new WatchHealth();
  private watchAdvice?: WatchAdvice;
  setWatchProfile(profile: WatchProfile) {
    if (this.watchPolicy.profile === profile) return;
    this.watchPolicy.profile = profile;
    this.watchAdvice = undefined;
    this.diagnoseEvent("watch-profile-" + profile);
    this.emit();
  }
  private room?: Room;
  private revision = 0;
  private video?: HTMLVideoElement;
  private previewVideo?: HTMLVideoElement;
  private videoTrack?: Track;
  private audioElements = new Map<string, HTMLMediaElement[]>();
  private mixer = new AudioMixer();
  private voices: VoicePlayback;
  private voiceActivity = new VoiceActivity();
  private speakerPoll?: ReturnType<typeof setInterval>;
  private movie = new MoviePlayback();
  private movieAudio?: { sid: string; track: RemoteAudioTrack };
  private subscriptions = new ShareSubscriptions();
  private microphoneRevision = 0;
  private microphoneWork?: Promise<void>;
  private microphoneDevice?: string;
  private microphoneWanted = false;
  private noiseMode: NoiseReduction = "enhanced";
  private effectMode: MicrophoneEffect = "none";
  private effectStrength = defaultMicrophoneReverbStrength;
  private effectStatus?: MicrophoneEffectStatus;
  private processorRevision = 0;
  private processorWork = Promise.resolve();
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
    private readonly inputLost?: () => void,
    private readonly chatted?: (roomId: string, message: ChatMessage) => void,
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
        const message = decodeRoomChat(
          payload,
          topic,
          senderIdentity,
          room.name,
        );
        if (message) {
          this.chatted?.(room.name, message);
          return;
        }
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
    const accompanying = participants.some((p) =>
      [...p.trackPublications.values()].some(isAccompaniment),
    );
    if (accompanying && !this.speakerPoll)
      this.speakerPoll = setInterval(() => this.emit(), 200);
    if (!accompanying && this.speakerPoll) {
      clearInterval(this.speakerPoll);
      this.speakerPoll = undefined;
    }
    this.subscriptions.sync(room);
    const sharer = participants.find((p) =>
      p.getTrackPublication(Track.Source.ScreenShare),
    );
    const publication = sharer?.getTrackPublication(Track.Source.ScreenShare);
    const viewing =
      sharer === room.localParticipant || this.subscriptions.watching;
    const next =
      viewing &&
      (sharer === room.localParticipant || this.subscriptions.videoVisible)
        ? publication?.track
        : undefined;
    this.videoTrack = next;
    const filmAudio = viewing
      ? sharer?.getTrackPublication(Track.Source.ScreenShareAudio)?.track
      : undefined;
    this.movie.tracks(
      next,
      filmAudio === this.movieAudio?.track ? this.movieAudio?.track : undefined,
    );
    const watchBuffering = this.watchPolicy.apply(
      next as RemoteTrack | undefined,
      this.movieAudio?.track,
    );
    this.changed({
      watchProfile: this.watchPolicy.profile,
      watchBuffering,
      watchAdvice:
        viewing &&
        sharer !== room.localParticipant &&
        this.subscriptions.videoVisible
          ? this.watchAdvice
          : undefined,
      revision: this.revision,
      state: room.state,
      participants: participants
        .filter((p) => !nativeOwner(p.identity))
        .map((p) => {
          const voice = voicePublication<
            LocalTrackPublication | RemoteTrackPublication
          >(p.trackPublications);
          const microphone = Boolean(voice?.track && !voice.isMuted);
          return {
            id: participantOwner(p.identity) ?? p.identity,
            name: p.name || "朋友",
            local: p === room.localParticipant,
            microphone,
            accompaniment: [...p.trackPublications.values()].some(
              (pub) => isAccompaniment(pub) && !pub.isMuted,
            ),
            microphoneAllowed:
              p.permissions?.canPublish !== false &&
              (!p.permissions?.canPublishSources.length ||
                p.permissions.canPublishSources.includes(2)),
            speaking:
              microphone &&
              (accompanying
                ? this.voiceActivity.active(voice!.trackSid) === true
                : p.isSpeaking),
            quality: p.connectionQuality,
          };
        })
        .reduce<ParticipantSummary[]>((all, p) => {
          const i = all.findIndex((other) => other.id === p.id);
          const previous = all[i];
          if (previous)
            all[i] = {
              ...(p.local ? p : previous),
              local: previous.local || p.local,
              microphone: previous.microphone || p.microphone,
              speaking: previous.speaking || p.speaking,
              accompaniment: previous.accompaniment || p.accompaniment,
            };
          else all.push(p);
          return all;
        }, []),
      sharer: sharer
        ? {
            id:
              nativeOwner(sharer.identity) ??
              participantOwner(sharer.identity) ??
              sharer.identity,
            name: sharer.name || "朋友",
            local:
              sharer === room.localParticipant ||
              nativeOwner(sharer.identity) ===
                (participantOwner(room.localParticipant.identity) ??
                  room.localParticipant.identity),
            hasVideo: Boolean(next),
          }
        : undefined,
      microphoneNoise: this.noiseStatus,
      microphoneEffect: this.effectStatus,
      audioBlocked: !room.canPlaybackAudio || this.voices.blocked,
      watching: this.subscriptions.watching,
      videoPaused:
        this.subscriptions.watching && !this.subscriptions.videoVisible,
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
      (!this.subscriptions.watching &&
        [Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(
          pub.source,
        )) ||
      (pub.source === Track.Source.ScreenShare &&
        !this.subscriptions.videoVisible)
    ) {
      pub.setSubscribed(false);
      return;
    }
    if (
      track instanceof RemoteAudioTrack &&
      pub.source === Track.Source.ScreenShareAudio &&
      nativeOwner(participant.identity) ===
        (this.room
          ? (participantOwner(this.room.localParticipant.identity) ??
            this.room.localParticipant.identity)
          : undefined)
    ) {
      pub.setSubscribed(false);
      return;
    }
    if (
      track instanceof RemoteAudioTrack &&
      pub.source === Track.Source.ScreenShareAudio
    ) {
      this.movieAudio = { sid: pub.trackSid, track };
      this.mixer.attach(
        pub.trackSid,
        participantOwner(participant.identity) ??
          nativeOwner(participant.identity) ??
          participant.identity,
        "screen",
        track,
      );
      this.emit();
      return;
    }
    if (track instanceof RemoteAudioTrack) {
      if (!isAccompaniment(pub))
        this.voiceActivity.bind(
          pub.trackSid,
          new MediaStream([track.mediaStreamTrack]),
        );
      const el = track.attach();
      el.dataset.cinegatherAudio = pub.source;
      el.dataset.cinegatherPurpose = isAccompaniment(pub)
        ? "accompaniment"
        : "voice";
      el.style.display = "none";
      document.body.append(el);
      this.audioElements.set(pub.trackSid, [el]);
      this.mixer.attach(
        pub.trackSid,
        participantOwner(participant.identity) ?? participant.identity,
        isAccompaniment(pub) ? "accompaniment" : "voice",
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
    this.voiceActivity.remove(sid);
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
    this.voiceActivity.clear();
    clearInterval(this.speakerPoll);
    this.speakerPoll = undefined;
    this.movie.tracks();
    this.movieAudio = undefined;
    this.videoTrack = undefined;
    if (this.video) this.video.srcObject = null;
    for (const elements of this.audioElements.values())
      for (const el of elements) el.remove();
    this.audioElements.clear();
    this.mixer.clear();
  }
  private viewingVideo?: HTMLVideoElement;
  setViewingVideoElement(element?: HTMLVideoElement) {
    this.viewingVideo = element;
    this.movie.bind(element ?? this.video);
    this.playbackProbe.bind(this.previewVideo ?? element ?? this.video);
  }
  setVideoElement(element?: HTMLVideoElement) {
    this.video = element;
    this.playbackProbe.bind(this.previewVideo ?? this.viewingVideo ?? element);
    this.movie.bind(this.viewingVideo ?? element);
  }
  setPreviewVideoElement(element?: HTMLVideoElement) {
    this.previewVideo = element;
    this.playbackProbe.bind(element ?? this.viewingVideo ?? this.video);
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
    if (!enabled) {
      const p =
        room &&
        voicePublication(room.localParticipant.trackPublications)?.track;
      if (p instanceof LocalAudioTrack) {
        const processor = p.getProcessor();
        if (processor instanceof KtvReverb) processor.setMuted(true);
      }
    }
    ++this.microphoneRevision;
    this.microphoneWanted = enabled;
    this.microphoneDevice = deviceId;
    if (!room) return;
    if (enabled && !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "语音需要使用 HTTPS 或本机地址，并允许 Chrome 使用麦克风",
      );
    if (this.microphoneWork) return this.microphoneWork;
    const work = this.applyMicrophone(room);
    this.microphoneWork = work;
    try {
      await work;
    } finally {
      if (this.microphoneWork === work) this.microphoneWork = undefined;
    }
  }
  private async applyMicrophone(room: Room) {
    while (this.room === room) {
      const revision = this.microphoneRevision,
        wanted = this.microphoneWanted;
      let publication = voicePublication(
        room.localParticipant.trackPublications,
      );
      if (wanted && !publication) {
        // The SDK's source lookup may find the independent accompaniment first.
        // Own the real microphone explicitly so mute/PTT/device changes stay scoped.
        const track = await createLocalAudioTrack({
          deviceId: this.microphoneDevice || undefined,
          ...microphoneConstraints(this.noiseMode),
        });
        if (this.room !== room || !this.microphoneWanted) {
          track.stop();
          if (this.room !== room) return;
          continue;
        }
        track.on(TrackEvent.Ended, () => {
          if (
            this.room === room &&
            this.microphoneWanted &&
            voicePublication(room.localParticipant.trackPublications)?.track ===
              track
          )
            this.inputLost?.();
        });
        try {
          publication = await room.localParticipant.publishTrack(track, {
            name: "cinegather-microphone",
            source: Track.Source.Microphone,
            stopMicTrackOnMute: false,
          });
        } catch (error) {
          track.stop();
          throw error;
        }
        if (this.room !== room) {
          await room.localParticipant.unpublishTrack(track, true);
          return;
        }
      }
      if (publication?.track instanceof LocalAudioTrack) {
        if (this.microphoneWanted) await publication.track.unmute();
        else await publication.track.mute();
        const currentProcessor = publication.track.getProcessor();
        if (currentProcessor instanceof KtvReverb)
          currentProcessor.setMuted(!this.microphoneWanted);
        if (
          this.microphoneWanted &&
          (this.noiseMode !== "enhanced" || !publication.track.getProcessor())
        )
          await this.noiseReduction(this.noiseMode);
      }
      if (revision === this.microphoneRevision) {
        this.emit();
        return;
      }
    }
  }
  setMicrophoneReverbStrength(value: number) {
    this.effectStrength = Number.isFinite(value)
      ? Math.round(Math.max(0, Math.min(100, value)))
      : defaultMicrophoneReverbStrength;
    const track =
      this.room &&
      voicePublication(this.room.localParticipant.trackPublications)?.track;
    const processor =
      track instanceof LocalAudioTrack ? track.getProcessor() : undefined;
    if (processor instanceof KtvReverb)
      processor.setStrength(this.effectStrength);
    if (this.effectStatus)
      this.effectStatus = {
        ...this.effectStatus,
        strength: this.effectStrength,
      };
    this.emit();
  }
  noiseReduction(mode: NoiseReduction) {
    return this.configureMicrophone(mode, this.effectMode);
  }
  async configureMicrophone(
    mode: NoiseReduction,
    effect: MicrophoneEffect = "none",
    strength = this.effectStrength,
  ) {
    this.setMicrophoneReverbStrength(strength);
    this.noiseMode = mode;
    this.effectMode = effect;
    const revision = ++this.processorRevision,
      room = this.room;
    if (!room) return;
    const run = this.processorWork
      .catch(() => {})
      .then(async () => {
        if (revision !== this.processorRevision || this.room !== room) return;
        const track = voicePublication(
          room.localParticipant.trackPublications,
        )?.track;
        if (!(track instanceof LocalAudioTrack)) return;
        const current = () =>
          revision === this.processorRevision &&
          this.room === room &&
          voicePublication(room.localParticipant.trackPublications)?.track ===
            track;
        this.noiseStatus = undefined;
        const status = (value: MicrophoneNoiseStatus) => {
          if (current()) {
            this.noiseStatus = value;
            this.emit();
          }
        };
        await track.applyConstraints(microphoneConstraints(mode));
        if (!current()) return;
        let processor = await createMicrophoneProcessor(
          mode,
          effect,
          status,
          () => !this.microphoneWanted,
          this.effectStrength,
        );
        if (!current()) {
          await processor?.destroy();
          return;
        }
        let active: MicrophoneEffect = "none";
        try {
          if (processor) {
            await track.setProcessor(processor);
            active = effect;
          } else {
            await track.stopProcessor();
            if (mode === "enhanced") {
              await track.applyConstraints(microphoneConstraints("basic"));
              status({
                requested: mode,
                active: "basic",
                reason: "enhancement-unavailable",
                engine: "platform",
              });
            }
          }
        } catch {
          await processor?.destroy().catch(() => {});
          if (!current()) return;
          await track.stopProcessor();
          if (mode === "enhanced") {
            processor = await createMicrophoneProcessor(mode, "none", status);
            if (!current()) {
              await processor?.destroy();
              return;
            }
            try {
              if (processor) await track.setProcessor(processor);
              else throw new Error("Enhancement unavailable");
            } catch {
              await processor?.destroy().catch(() => {});
              if (!current()) return;
              await track.stopProcessor();
              await track.applyConstraints(microphoneConstraints("basic"));
              status({
                requested: mode,
                active: "basic",
                reason: "processor-unavailable",
                engine: "platform",
              });
            }
          }
        }
        if (!current()) return;
        if (mode !== "enhanced")
          this.noiseStatus = { requested: mode, active: mode };
        const attached = track.getProcessor();
        if (attached instanceof KtvReverb) {
          attached.setMuted(!this.microphoneWanted);
          attached.setStrength(this.effectStrength);
        }
        this.effectStatus = {
          requested: effect,
          active,
          strength: this.effectStrength,
          ...(effect !== active
            ? { reason: "reverb-unavailable" as const }
            : {}),
        };
        this.voiceActivity.bind(
          voicePublication(room.localParticipant.trackPublications)!.trackSid,
          new MediaStream([track.mediaStreamTrack]),
        );
        this.emit();
      });
    this.processorWork = run;
    return run;
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
  async publishAccompaniment(track: MediaStreamTrack) {
    const room = this.room;
    const permission = room?.localParticipant.permissions;
    if (
      !room ||
      room.state !== ConnectionState.Connected ||
      permission?.canPublish === false ||
      (permission?.canPublishSources.length &&
        !permission.canPublishSources.includes(2))
    ) {
      track.stop();
      throw new Error("当前无法发布伴奏，请检查房间连接和开麦权限");
    }
    try {
      await room.localParticipant.publishTrack(track, {
        name: ACCOMPANIMENT_TRACK,
        source: Track.Source.Microphone,
        forceStereo: true,
        dtx: false,
        red: true,
        audioPreset: { maxBitrate: 96000 },
        stopMicTrackOnMute: false,
      });
      if (this.room !== room || track.readyState !== "live") {
        await room.localParticipant.unpublishTrack(track, true);
        throw new Error("伴奏已停止");
      }
      this.emit();
    } catch (error) {
      track.stop();
      throw error;
    }
  }
  async unpublishAccompaniment(track: MediaStreamTrack) {
    await this.room?.localParticipant.unpublishTrack(track, true);
    track.stop();
    this.emit();
  }
  async selectBrowserShare(
    quality: Quality,
    audio: boolean,
    replacing = false,
  ) {
    const selected = await this.browserCapture.select(
      quality,
      audio,
      replacing,
    );
    if (selected) {
      const stream = this.browserCapture.selected;
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
  cancelBrowserSelection() {
    this.browserCapture.cancelSelection();
  }
  async replaceBrowserShare() {
    const room = this.room,
      stream = this.browserCapture.selected;
    const publication = room?.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    );
    const video = publication?.track;
    if (
      !room ||
      room.state !== ConnectionState.Connected ||
      !video ||
      !stream ||
      stream === this.browserCapture.current ||
      stream.getVideoTracks()[0]?.readyState !== "live"
    )
      throw new Error("共享已停止或新的画面不可用");
    const audio = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShareAudio,
    )?.track;
    const oldVideo = video.mediaStreamTrack,
      oldAudio = audio?.mediaStreamTrack;
    const nextVideo = stream.getVideoTracks()[0]!,
      nextAudio = stream.getAudioTracks()[0];
    let addedAudio = false;
    const current = () =>
      this.room === room &&
      room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
        ?.track === video &&
      this.browserCapture.selected === stream;
    try {
      await video.replaceTrack(nextVideo, true);
      if (!current()) throw new Error("共享已停止");
      if (audio && nextAudio) await audio.replaceTrack(nextAudio, true);
      else if (nextAudio) {
        await room.localParticipant.publishTrack(nextAudio, {
          source: Track.Source.ScreenShareAudio,
          dtx: false,
          red: true,
          forceStereo: true,
        });
        addedAudio = true;
      }
      if (!current()) throw new Error("共享已停止");
      if (audio && !nextAudio)
        await room.localParticipant.unpublishTrack(audio, true);
      this.browserCapture.commitSelection();
      oldVideo.stop();
      oldAudio?.stop();
      this.emit();
    } catch (error) {
      if (current()) {
        await video.replaceTrack(oldVideo, true).catch(() => {});
        if (audio && oldAudio && nextAudio)
          await audio.replaceTrack(oldAudio, true).catch(() => {});
        if (addedAudio && nextAudio)
          await room.localParticipant
            .unpublishTrack(nextAudio, true)
            .catch(() => {});
      }
      this.browserCapture.cancelSelection();
      throw error;
    }
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
  memberVolumes(volumes: Record<string, number>, applyExisting = true) {
    this.mixer.replaceMembers(volumes, applyExisting && Boolean(this.room));
  }
  watch(enabled: boolean) {
    this.watchHealth.reset();
    this.watchAdvice = undefined;
    this.subscriptions.watch(enabled);
    this.emit();
  }
  setVideoVisible(visible: boolean) {
    if (this.subscriptions.videoVisible === visible) return;
    this.watchHealth.reset();
    this.watchAdvice = undefined;
    this.subscriptions.setVideoVisible(visible);
    this.diagnoseEvent(visible ? "view-video-visible" : "view-video-hidden");
    this.emit();
  }
  get inputRecoveryNeeded() {
    const room = this.room;
    const track =
      room && voicePublication(room.localParticipant.trackPublications)?.track;
    return Boolean(
      room &&
        room.state === ConnectionState.Connected &&
        this.microphoneWanted &&
        (!track || track.mediaStreamTrack.readyState === "ended"),
    );
  }
  async devices(input?: string, output?: string) {
    if (input !== undefined) this.microphoneDevice = input;
    const room = this.room;
    if (!room) return;
    if (input !== undefined) {
      await this.microphoneWork?.catch(() => {});
      if (this.room !== room) return;
      let voice = voicePublication(room.localParticipant.trackPublications);
      if (!voice && this.microphoneWanted) {
        await this.microphone(true, input);
        voice = voicePublication(room.localParticipant.trackPublications);
      } else if (voice?.track instanceof LocalAudioTrack) {
        // setDeviceId defers reacquisition while muted, retaining PTT/moderation.
        await voice.track.setDeviceId(input || "default");
        // SDK device-loss handling may mute a failed track. Only restore it if
        // the user's current intent is still open; mute/PTT/admin actions clear it.
        if (this.room === room && this.microphoneWanted && voice.track.isMuted)
          await this.microphone(true, input);
      }
      if (voice?.track && this.room === room)
        this.voiceActivity.bind(
          voice.trackSid,
          new MediaStream([voice.track.mediaStreamTrack]),
        );
    }
    if (
      output !== undefined &&
      this.room === room &&
      typeof HTMLMediaElement.prototype.setSinkId === "function"
    )
      await room.switchActiveDevice("audiooutput", output || "default");
  }
  async startAudio() {
    await Promise.all([this.room?.startAudio(), this.voices.resume()]);
    this.emit();
  }
  async diagnostics() {
    const detail = await this.detailedDiagnostics();
    return {
      watchProfile: detail.watchProfile,
      watchTargetMs: detail.watchTargetMs,
      watchBuffering: detail.watchBuffering,
      state: detail.state,
      microphoneNoise: detail.microphoneNoise,
      microphoneEffect: detail.microphoneEffect,
      watching: detail.watching,
      videoPaused: detail.videoPaused,
      capturedAt: new Date().toISOString(),
      issues: detail.issues,
      encoderCapabilities: detail.encoderCapabilities,
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
    const issues: DiagnosticIssue[] = [];
    const issue = (value: DiagnosticIssue) => {
      if (issues.length < 64) issues.push(value);
    };
    const reports = await Promise.all(
      tracks
        .sort(
          (a, b) =>
            Number(b.pub.kind === "video") - Number(a.pub.kind === "video"),
        )
        .slice(0, 40)
        .map(
          async (
            { p, pub },
            index,
          ): Promise<MediaDiagnostic["tracks"][number] | undefined> => {
            const trackIssue = (value: DiagnosticIssue) =>
              issue({
                ...value,
                field: value.field?.replace(
                  "media.tracks",
                  `media.tracks.${index}`,
                ),
              });
            try {
              let participant = this.diagnosticHashes.get(p.identity);
              if (!participant) {
                participant = diagnosticHash(p.identity);
                this.diagnosticHashes.set(p.identity, participant);
              }
              let settings: MediaTrackSettings | undefined;
              try {
                settings = pub.track?.mediaStreamTrack.getSettings();
              } catch {
                trackIssue({
                  stage: "track",
                  code: "read-failed",
                  field: "media.tracks.settings",
                });
              }
              return {
                sender:
                  p === room?.localParticipant && pub.kind === "video"
                    ? senderDiagnostics(
                        (pub.track as LocalVideoTrack | undefined)?.sender,
                      )
                    : undefined,
                track: pub.trackSid,
                participant: await participant,
                source: pub.source,
                local: p === room?.localParticipant,
                kind: pub.kind,
                muted: pub.isMuted,
                subscribed: pub.isSubscribed,
                streamState: pub.track?.streamState,
                settings,
                videoQuality:
                  "videoQuality" in pub
                    ? (pub as RemoteTrackPublication).videoQuality
                    : undefined,
                enabled:
                  "isEnabled" in pub
                    ? (pub as RemoteTrackPublication).isEnabled
                    : undefined,
                ...(pub.track
                  ? await boundedStats(
                      () => this.diagnosticReport(pub.track!),
                      1200,
                      trackIssue,
                    )
                  : { status: "unavailable" as const, stats: [] }),
              };
            } catch {
              trackIssue({
                stage: "track",
                code: "read-failed",
                field: "media.tracks",
              });
              return undefined;
            }
          },
        ),
    );
    let playback: MediaDiagnostic["playback"];
    try {
      playback = this.playbackProbe.sample();
    } catch {
      issue({
        stage: "playback",
        code: "sample-failed",
        field: "media.playback",
      });
    }
    for (const value of this.playbackProbe.takeIssues()) issue(value);
    const screen = reports.find(
      (report) =>
        report && !report.local && report.source === Track.Source.ScreenShare,
    );
    const stat = screen?.stats.find(
      (stat) => stat.type === "inbound-rtp" && stat.kind === "video",
    );
    const watchAdvice = this.watchHealth.sample({
      track: screen?.track,
      at: performance.now(),
      watching: this.subscriptions.watching,
      visible:
        this.subscriptions.videoVisible &&
        room?.state === ConnectionState.Connected,
      profile: this.watchPolicy.profile,
      jitter: stat?.jitter,
      frameAgeMs: playback?.frameAgeMs,
      maxFrameGapMs: playback?.maxFrameGapMs,
    });
    if (watchAdvice !== this.watchAdvice) {
      this.watchAdvice = watchAdvice;
      this.emit();
    }
    return {
      watchProfile: this.watchPolicy.profile,
      watchTargetMs: watchProfiles[this.watchPolicy.profile].targetMs,
      watchBuffering: this.watchPolicy.apply(
        this.videoTrack as RemoteTrack | undefined,
        this.movieAudio?.track,
      ),
      issues: issues.length ? issues : undefined,
      encoderCapabilities: videoCapabilities(),
      state: room?.state ?? "disconnected",
      watching: this.subscriptions.watching,
      videoPaused:
        this.subscriptions.watching && !this.subscriptions.videoVisible,
      microphoneNoise: this.noiseStatus
        ? {
            requested: this.noiseStatus.requested,
            active: this.noiseStatus.active,
            fallback: Boolean(this.noiseStatus.reason),
            engine: this.noiseStatus.engine,
          }
        : undefined,
      microphoneEffect: this.effectStatus
        ? {
            requested: this.effectStatus.requested,
            active: this.effectStatus.active,
            fallback: Boolean(this.effectStatus.reason),
            strength: this.effectStrength,
          }
        : undefined,
      tracks: reports.filter(
        (report): report is NonNullable<typeof report> => report !== undefined,
      ),
      playback,
    };
  }
  async disconnect() {
    if (this.room) this.diagnoseEvent("local-disconnect");
    this.diagnosticHashes.clear();
    this.subscriptions.reset();
    this.browserCapture.stop();
    ++this.revision;
    ++this.microphoneRevision;
    this.microphoneWork = undefined;
    this.microphoneWanted = false;
    this.noiseStatus = undefined;
    this.effectStatus = undefined;
    ++this.processorRevision;
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
