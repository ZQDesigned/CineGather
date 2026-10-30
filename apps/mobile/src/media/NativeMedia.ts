import { AppState, PermissionsAndroid, Platform } from "react-native";
import { AudioSession, AndroidAudioTypePresets } from "@livekit/react-native";
import {
  Room,
  RoomEvent,
  Track,
  RemoteAudioTrack,
  DisconnectReason,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { MobileMicrophoneIntent } from "@cinegather/client-core";
import {
  ShareSubscriptions,
  decodeRoomChat,
  decodeRoomControl,
  isAccompaniment,
  voicePublication,
  boundedStats,
} from "@cinegather/media-core/protocol";
import {
  nativeOwner,
  participantOwner,
  type ChatMessage,
} from "@cinegather/contracts";

export interface MediaMember {
  id: string;
  name: string;
  speaking: boolean;
  microphone: boolean;
  accompaniment: boolean;
}
export interface MediaSnapshot {
  connected: boolean;
  reconnecting: boolean;
  microphone: boolean;
  microphoneAllowed: boolean;
  watching: boolean;
  foreground: boolean;
  members: MediaMember[];
  sharer?: string;
  video?: {
    participant: RemoteParticipant;
    publication: RemoteTrackPublication;
    source: Track.Source;
  };
  error?: string;
}

export class NativeMedia {
  room?: Room;
  private revision = 0;
  private listeners = new Set<() => void>();
  private subscriptions = new ShareSubscriptions();
  private microphone = new MobileMicrophoneIntent();
  private micQueue = Promise.resolve();
  private voiceGain = 1;
  private shareGain = 1;
  private gains = new Map<string, number>();
  private foreground = AppState.currentState === "active";
  private current: MediaSnapshot = {
    connected: false,
    reconnecting: false,
    microphone: false,
    microphoneAllowed: true,
    watching: false,
    foreground: true,
    members: [],
  };
  constructor(
    private readonly events: {
      message(message: ChatMessage): void;
      disconnected(reason: string): void;
      error(error: unknown): void;
      foregroundService?(microphone: boolean): Promise<void>;
      stopService?(): Promise<void>;
    },
  ) {}
  snapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private sync = () => {
    const room = this.room;
    if (!room) return;
    this.subscriptions.setVideoVisible(this.foreground);
    this.subscriptions.sync(room);
    const participants = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ];
    const sharer = [...room.remoteParticipants.values()].find((p) =>
      p.getTrackPublication(Track.Source.ScreenShare),
    );
    const publication = sharer?.getTrackPublication(Track.Source.ScreenShare);
    const owner =
      sharer &&
      (nativeOwner(sharer.identity) ??
        participantOwner(sharer.identity) ??
        sharer.identity);
    const members = participants
      .filter((p) => !nativeOwner(p.identity))
      .map((p) => ({
        id: participantOwner(p.identity) ?? p.identity,
        name: p.name || "房间成员",
        speaking: p.isSpeaking,
        microphone:
          !!voicePublication<{
            source: Track.Source;
            trackName: string;
            isMuted: boolean;
          }>(p.audioTrackPublications) &&
          !voicePublication<{
            source: Track.Source;
            trackName: string;
            isMuted: boolean;
          }>(p.audioTrackPublications)?.isMuted,
        accompaniment: [...p.audioTrackPublications.values()].some(
          (t) => isAccompaniment(t) && !t.isMuted,
        ),
      }));
    for (const p of room.remoteParticipants.values())
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track instanceof RemoteAudioTrack) {
          const shared = pub.source === Track.Source.ScreenShareAudio;
          const user =
            participantOwner(p.identity) ??
            nativeOwner(p.identity) ??
            p.identity;
          pub.track.setVolume(
            (shared ? this.shareGain : this.voiceGain) *
              (this.gains.get(user) ?? 1),
          );
        }
      }
    this.current = {
      ...this.current,
      connected: room.state === "connected",
      reconnecting: room.state === "reconnecting",
      microphone: room.localParticipant.isMicrophoneEnabled,
      watching: this.subscriptions.watching,
      foreground: this.foreground,
      members,
      sharer: owner
        ? (members.find((m) => m.id === owner)?.name ??
          sharer?.name ??
          "房间成员")
        : undefined,
      video:
        publication?.track &&
        sharer &&
        this.subscriptions.watching &&
        this.foreground
          ? {
              participant: sharer,
              publication,
              source: Track.Source.ScreenShare,
            }
          : undefined,
    };
    this.emit();
  };
  async connect(url: string, token: string) {
    await this.disconnect();
    const revision = ++this.revision;
    await AudioSession.configureAudio({
      android: {
        audioTypeOptions: {
          ...AndroidAudioTypePresets.communication,
          manageAudioFocus: false,
        },
        preferredOutputList: ["bluetooth", "headset", "earpiece", "speaker"],
      },
      ios: { defaultOutput: "earpiece" },
    });
    await AudioSession.startAudioSession();
    const room = new Room({
      adaptiveStream: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      publishDefaults: { stopMicTrackOnMute: true },
    });
    this.room = room;
    const syncEvents = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.Reconnecting,
      RoomEvent.Reconnected,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const;
    for (const event of syncEvents) room.on(event, this.sync);
    room.on(RoomEvent.ParticipantPermissionsChanged, (_previous, p) => {
      if (p !== room.localParticipant) return;
      const permission = p.permissions;
      this.setAllowed(
        Boolean(
          permission?.canPublish &&
            (!permission.canPublishSources.length ||
              permission.canPublishSources.includes(2)),
        ),
      );
    });
    room.on(
      RoomEvent.DataReceived,
      (payload, participant, _kind, topic, _encryption, senderIdentity) => {
        if (participant || this.room !== room) return;
        const message = decodeRoomChat(
          payload,
          topic,
          senderIdentity,
          room.name,
        );
        if (message) this.events.message(message);
        const control = decodeRoomControl(
          payload,
          topic,
          senderIdentity,
          room.name,
        );
        if (control?.action === "mute-microphone") {
          this.microphone.setWanted(false);
          void this.reconcileMic();
        }
      },
    );
    room.on(RoomEvent.TrackSubscriptionFailed, (_sid, _p, reason) =>
      this.events.error(new Error(`无法接收媒体：${String(reason)}`)),
    );
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.room !== room) return;
      this.microphone.setInRoom(false);
      this.current = {
        ...this.current,
        connected: false,
        microphone: false,
        video: undefined,
      };
      this.emit();
      this.events.disconnected(
        reason === DisconnectReason.PARTICIPANT_REMOVED
          ? "你已被房主移出房间"
          : "房间连接已断开，请重新加入",
      );
    });
    try {
      await room.connect(url, token, { autoSubscribe: false });
      if (revision !== this.revision) {
        await room.disconnect();
        return;
      }
      await this.events.foregroundService?.(false);
      this.microphone.setInRoom(true);
      this.sync();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }
  async disconnect() {
    ++this.revision;
    this.microphone.setInRoom(false);
    const room = this.room;
    this.room = undefined;
    this.subscriptions.reset();
    if (room) {
      room.removeAllListeners();
      await room.disconnect();
    }
    await this.micQueue.catch(() => {});
    await this.events.stopService?.().catch(() => {});
    await AudioSession.stopAudioSession().catch(() => {});
    this.current = {
      connected: false,
      reconnecting: false,
      microphone: false,
      microphoneAllowed: true,
      watching: false,
      foreground: this.foreground,
      members: [],
    };
    this.emit();
  }
  setForeground(active: boolean) {
    this.foreground = active;
    this.sync();
  }
  watch(enabled: boolean) {
    this.subscriptions.watch(enabled);
    this.sync();
  }
  setAllowed(allowed: boolean) {
    this.microphone.setAllowed(allowed);
    this.current = { ...this.current, microphoneAllowed: allowed };
    void this.reconcileMic();
  }
  safetyMute() {
    this.microphone.setWanted(false);
    void this.reconcileMic();
  }
  interrupt(interrupted: boolean) {
    this.microphone.setInterrupted(interrupted);
    void this.reconcileMic();
  }
  async toggleMicrophone() {
    const room = this.room,
      revision = this.revision;
    if (!room || !this.current.connected) return;
    if (this.microphone.requested) {
      this.microphone.setWanted(false);
      return this.reconcileMic();
    }
    if (!this.current.microphoneAllowed)
      throw new Error("房主已禁止你开启麦克风");
    if (!this.foreground) throw new Error("请返回应用后开启麦克风");
    if (Platform.OS === "android") {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (revision !== this.revision || this.room !== room) return;
      const granted = permission === PermissionsAndroid.RESULTS.GRANTED;
      this.microphone.setPermission(granted);
      if (!granted)
        throw new Error("麦克风权限未开启，请在系统设置中允许映聚使用麦克风");
    } else this.microphone.setPermission(true); // Native WebRTC requests iOS permission on capture.
    await this.events.foregroundService?.(true);
    if (revision !== this.revision || this.room !== room || !this.foreground)
      return;
    this.microphone.setInterrupted(false);
    this.microphone.setWanted(true);
    return this.reconcileMic();
  }
  private reconcileMic() {
    const room = this.room;
    const task = this.micQueue
      .catch(() => {})
      .then(async () => {
        if (!room || room !== this.room) return;
        try {
          await room.localParticipant.setMicrophoneEnabled(
            this.microphone.enabled,
          );
        } catch (error) {
          this.microphone.setWanted(false);
          this.events.error(error);
        }
        if (room === this.room) this.sync();
      });
    this.micQueue = task;
    return task;
  }
  async diagnostics() {
    const room = this.room;
    if (!room) return { connected: false, tracks: [] };
    const tracks = await Promise.all(
      [room.localParticipant, ...room.remoteParticipants.values()].flatMap(
        (p) =>
          [...p.trackPublications.values()].map(async (publication) => ({
            sid: publication.trackSid,
            source: publication.source,
            kind: publication.kind,
            muted: publication.isMuted,
            subscription:
              "isDesired" in publication
                ? Boolean(publication.isDesired)
                : undefined,
            ...(publication.track
              ? await boundedStats(() => publication.track!.getRTCStatsReport())
              : { status: "unsubscribed", stats: [] }),
          })),
      ),
    );
    return {
      time: Date.now(),
      connected: room.state,
      foreground: this.foreground,
      watching: this.subscriptions.watching,
      microphone: this.current.microphone,
      tracks,
    };
  }
  setGain(kind: "voice" | "share", gain: number) {
    if (kind === "voice") this.voiceGain = Math.max(0, Math.min(2, gain));
    else this.shareGain = Math.max(0, Math.min(2, gain));
    this.sync();
  }
  setMemberGain(userId: string, gain: number) {
    this.gains.set(userId, Math.max(0, Math.min(2, gain)));
    this.sync();
  }
  async outputs() {
    return this.room ? AudioSession.getAudioOutputs() : [];
  }
  async selectOutput(output: string) {
    if (Platform.OS === "ios" && output === "default")
      await AudioSession.showAudioRoutePicker();
    else await AudioSession.selectAudioOutput(output);
  }
}
