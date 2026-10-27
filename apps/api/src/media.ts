import { sessionCredential } from "./session-context";
import {
  DataPacket_Kind,
  IngressClient,
  IngressInput,
  IngressAudioOptions,
  IngressVideoOptions,
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
} from "livekit-server-sdk";
import { config } from "./config";
import {
  MAX_ROOM_MEMBERS,
  ACCOMPANIMENT_TRACK,
  ROOM_CONTROL_TOPIC,
  ROOM_CHAT_TOPIC,
  type ChatMessage,
  type RoomControl,
  nativeIdentity,
  memberIdentity,
  participantOwner,
  type User,
} from "@cinegather/contracts";
import { randomUUID } from "node:crypto";
export class MediaGateway {
  readonly client = new RoomServiceClient(
    config.livekitInternalUrl,
    config.livekitKey,
    config.livekitSecret,
    { requestTimeout: 5 },
  );
  readonly ingress = new IngressClient(
    config.livekitInternalUrl,
    config.livekitKey,
    config.livekitSecret,
    { requestTimeout: 5 },
  );
  async createNative(roomId: string, user: User, leaseId: string) {
    return this.ingress.createIngress(IngressInput.WHIP_INPUT, {
      name: `cinegather/native/v1/${leaseId}`,
      roomName: roomId,
      participantIdentity: nativeIdentity(user.id, randomUUID()),
      participantName: user.displayName,
      enableTranscoding: false,
      audio: new IngressAudioOptions({
        name: "影片声音",
        source: TrackSource.SCREEN_SHARE_AUDIO,
      }),
      video: new IngressVideoOptions({
        name: "影片画面",
        source: TrackSource.SCREEN_SHARE,
      }),
    });
  }
  async deleteNative(roomId: string, identity: string, ingressId: string) {
    // Remove the SFU session even if ingress signalling is temporarily unavailable.
    await this.remove(roomId, identity);
    try {
      await this.ingress.deleteIngress(ingressId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  readonly webhooks = new WebhookReceiver(
    config.livekitKey,
    config.livekitSecret,
  );
  async participants(roomId: string, verifyLive = false) {
    try {
      const listed = await this.client.listParticipants(roomId);
      if (!verifyLive)
        return listed.map((p) => ({
          ...p,
          rawIdentity: p.identity,
          identity: participantOwner(p.identity) ?? p.identity,
        }));
      // Redis can outlive the serving SFU node. A no-op RPC verifies the room
      // without changing metadata, permissions or existing media tracks.
      const live = await Promise.all(
        listed.map(async (participant) => {
          try {
            await this.client.updateParticipant(
              roomId,
              participant.identity,
              {},
            );
            return participant;
          } catch (error) {
            if (isNotFound(error)) return undefined;
            throw error;
          }
        }),
      );
      return live
        .filter((p) => p !== undefined)
        .map((p) => ({
          ...p,
          rawIdentity: p.identity,
          identity: participantOwner(p.identity) ?? p.identity,
        }));
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }
  async ensureRoom(roomId: string) {
    await this.client.createRoom({
      name: roomId,
      // A live SFU room's ceiling is immutable. Reserve the application maximum
      // plus one native publisher; admission enforces the editable business cap.
      maxParticipants: MAX_ROOM_MEMBERS * 5 + 1,
      emptyTimeout: 300,
      departureTimeout: 60,
    });
  }
  async deleteRoom(roomId: string) {
    try {
      await this.client.deleteRoom(roomId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  async issue(roomId: string, user: User, microphoneAllowed = true) {
    const access = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: sessionCredential(user)
        ? memberIdentity(user.id, sessionCredential(user)!)
        : user.id,
      name: user.displayName,
      ttl: 60,
    });
    access.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish: microphoneAllowed,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: microphoneAllowed ? [TrackSource.MICROPHONE] : [],
    });
    return access.toJwt();
  }
  private async targets(roomId: string, id: string) {
    if (!participantOwner(id) || id.startsWith("cinegather/")) return [id];
    const peers = await this.participants(roomId);
    const identities = peers
      .filter((p) => p.identity === id)
      .map((p) => p.rawIdentity ?? p.identity);
    return identities.length ? identities : [id];
  }
  async setShare(
    roomId: string,
    userId: string,
    allow: boolean,
    microphoneAllowed?: boolean,
  ) {
    for (const identity of await this.targets(roomId, userId)) {
      const p = await this.client.getParticipant(roomId, identity);
      const permission = p.permission;
      const mic =
        microphoneAllowed ??
        (permission?.canPublish !== false &&
          (!permission?.canPublishSources.length ||
            permission.canPublishSources.includes(TrackSource.MICROPHONE)));
      await this.setPermissions(roomId, identity, mic, allow);
    }
  }
  async setPermissions(
    roomId: string,
    userId: string,
    microphoneAllowed: boolean,
    sharingAllowed: boolean,
  ) {
    for (const identity of await this.targets(roomId, userId))
      await this.client.updateParticipant(roomId, identity, {
        permission: {
          canPublish: microphoneAllowed || sharingAllowed,
          canSubscribe: true,
          canPublishData: false,
          canUpdateMetadata: false,
          canPublishSources: [
            ...(microphoneAllowed ? [TrackSource.MICROPHONE] : []),
            ...(sharingAllowed
              ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
              : []),
          ],
        },
      });
  }
  async chat(roomId: string, message: ChatMessage) {
    await this.client.sendData(
      roomId,
      new TextEncoder().encode(JSON.stringify({ roomId, message })),
      DataPacket_Kind.RELIABLE,
      { topic: ROOM_CHAT_TOPIC },
    );
  }
  async control(userId: string, command: RoomControl) {
    await this.client.sendData(
      command.roomId,
      new TextEncoder().encode(JSON.stringify(command)),
      DataPacket_Kind.RELIABLE,
      {
        destinationIdentities: await this.targets(command.roomId, userId),
        topic: ROOM_CONTROL_TOPIC,
      },
    );
  }
  private async muteTracks(
    roomId: string,
    userId: string,
    accompaniment: boolean,
  ) {
    for (const p of (await this.participants(roomId)).filter(
      (p) => p.identity === userId || p.rawIdentity === userId,
    ))
      for (const t of p.tracks ?? [])
        if (
          t.source === TrackSource.MICROPHONE &&
          (t.name === ACCOMPANIMENT_TRACK) === accompaniment
        )
          await this.client.mutePublishedTrack(
            roomId,
            p.rawIdentity ?? p.identity,
            t.sid,
            true,
          );
  }
  async muteMicrophone(
    roomId: string,
    userId: string,
    _tracks: { sid: string; source: TrackSource; name?: string }[],
  ) {
    await this.muteTracks(roomId, userId, false);
    await this.control(userId, { action: "mute-microphone", roomId });
  }
  async stopAccompaniment(
    roomId: string,
    userId: string,
    _tracks: { sid: string; source: TrackSource; name?: string }[],
  ) {
    await this.muteTracks(roomId, userId, true);
    await this.control(userId, { action: "stop-accompaniment", roomId });
  }
  async remove(roomId: string, userId: string) {
    for (const identity of await this.targets(roomId, userId))
      try {
        await this.client.removeParticipant(roomId, identity, {
          revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
        });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
  }
}
function isNotFound(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e.code === "not_found" ||
      // LiveKit may retain Redis metadata after the room's serving node is gone.
      (e.code === "unknown" &&
        e instanceof Error &&
        e.message === "could not find object") ||
      (e.code === "unavailable" &&
        e instanceof Error &&
        e.message === "no response from servers"))
  );
}
export const media = new MediaGateway();
