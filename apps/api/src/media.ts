import {
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
import { nativeIdentity, type User } from "@cinegather/contracts";
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
  async participants(roomId: string) {
    try {
      return await this.client.listParticipants(roomId);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }
  async ensureRoom(roomId: string, capacity: number) {
    await this.client.createRoom({
      name: roomId,
      maxParticipants: capacity + 1,
      emptyTimeout: 300,
      departureTimeout: 60,
    });
  }
  async issue(roomId: string, user: User) {
    const access = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: 60,
    });
    access.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: [TrackSource.MICROPHONE],
    });
    return access.toJwt();
  }
  async setShare(roomId: string, userId: string, allow: boolean) {
    await this.client.updateParticipant(roomId, userId, {
      permission: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canUpdateMetadata: false,
        canPublishSources: allow
          ? [
              TrackSource.MICROPHONE,
              TrackSource.SCREEN_SHARE,
              TrackSource.SCREEN_SHARE_AUDIO,
            ]
          : [TrackSource.MICROPHONE],
      },
    });
  }
  async remove(roomId: string, userId: string) {
    try {
      await this.client.removeParticipant(roomId, userId, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
}
function isNotFound(e: unknown) {
  return (
    typeof e === "object" && e !== null && "code" in e && e.code === "not_found"
  );
}
export const media = new MediaGateway();
