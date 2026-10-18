import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import { config } from './config';
import type { User } from '@cinegather/contracts';
export class MediaGateway {
  readonly client = new RoomServiceClient(config.livekitInternalUrl, config.livekitKey, config.livekitSecret, { requestTimeout: 5 });
  readonly webhooks = new WebhookReceiver(config.livekitKey, config.livekitSecret);
  async participants(roomId: string) {
    try { return await this.client.listParticipants(roomId); }
    catch (e) { if (isNotFound(e)) return []; throw e; }
  }
  async ensureRoom(roomId: string, capacity: number) {
    await this.client.createRoom({ name: roomId, maxParticipants: capacity, emptyTimeout: 300, departureTimeout: 60 });
  }
  async issue(roomId: string, user: User) {
    const access = new AccessToken(config.livekitKey, config.livekitSecret, { identity: user.id, name: user.displayName, ttl: 60 });
    access.addGrant({ room: roomId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false, canPublishSources: [TrackSource.MICROPHONE] });
    return access.toJwt();
  }
  async setShare(roomId: string, userId: string, allow: boolean) {
    await this.client.updateParticipant(roomId, userId, { permission: { canPublish: true, canSubscribe: true, canPublishData: false, canUpdateMetadata: false, canPublishSources: allow ? [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [TrackSource.MICROPHONE] } });
  }
  async remove(roomId: string, userId: string) {
    try { await this.client.removeParticipant(roomId, userId, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }); }
    catch (e) { if (!isNotFound(e)) throw e; }
  }
}
function isNotFound(e: unknown) { return typeof e === 'object' && e !== null && 'code' in e && e.code === 'not_found'; }
export const media = new MediaGateway();
