import {
  AccessToken,
  TokenVerifier,
  TrackSource,
  IngressInput,
  IngressAudioOptions,
  IngressVideoOptions,
} from "livekit-server-sdk";
import { z } from "zod";
import {
  esportsChannelSchema,
  esportsChannelName,
  memberIdentity,
  nativeIdentity,
  type EsportsChannel,
  type User,
} from "@cinegather/contracts";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { media } from "./media";
import { fail } from "./errors";

export const esportsScopeSchema = z.object({
  format: z.literal("esports-v1"),
  roomId: z.uuid(),
  userId: z.uuid(),
  credentialId: z.uuid(),
  seatRevision: z.number().int().positive(),
  channel: esportsChannelSchema.optional(),
  grantId: z.uuid().optional(),
});
export type EsportsScope = z.infer<typeof esportsScopeSchema>;
export type EsportsRights = {
  publish: boolean;
  subscribe: boolean;
  sources: TrackSource[];
};
export function esportsReady() {
  if (
    !config.esportsGatewayUrl ||
    !config.esportsAdmissionSecret ||
    config.esportsAdmissionSecret.length < 32 ||
    config.esportsAdmissionSecret.includes("REPLACE")
  )
    fail(503, "ESPORTS_NOT_READY", "赛事房媒体通道尚未配置，请联系管理员");
  return config.esportsGatewayUrl;
}
export async function issueEsports(
  user: User,
  scope: EsportsScope,
  rights: EsportsRights,
) {
  esportsReady();
  const access = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: memberIdentity(scope.userId, scope.credentialId),
    name: user.displayName,
    ttl: 60,
    metadata: JSON.stringify(scope),
  });
  access.addGrant({
    room: scope.channel
      ? esportsChannelName(scope.roomId, scope.channel)
      : scope.roomId,
    roomJoin: true,
    canPublish: rights.publish,
    canSubscribe: rights.subscribe,
    canPublishSources: rights.sources,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return access.toJwt();
}
export const verifyEsportsToken = (token: string) =>
  new TokenVerifier(config.livekitKey, config.livekitSecret).verify(token, 0);
export const controlRights: EsportsRights = {
  publish: false,
  subscribe: false,
  sources: [],
};
export async function removeEsportsChannel(
  roomId: string,
  channel: EsportsChannel,
  userId: string,
) {
  await media.remove(esportsChannelName(roomId, channel), userId);
}
export async function removeEsportsMember(roomId: string, userId: string) {
  // Close all child sessions, including refreshed tokens and interrupted warming.
  const channels = await media.client.listRooms();
  for (const channel of channels)
    if (channel.name.startsWith(`cg-esports/${roomId}/`))
      await media.remove(channel.name, userId);
}
export async function createEsportsNative(
  roomId: string,
  publicationId: string,
  user: User,
  leaseId: string,
) {
  return media.ingress.createIngress(IngressInput.WHIP_INPUT, {
    name: `cinegather/esports/v1/${leaseId}`,
    roomName: esportsChannelName(roomId, { kind: "video", publicationId }),
    participantIdentity: nativeIdentity(user.id, randomUUID()),
    participantName: user.displayName,
    enableTranscoding: false,
    audio: new IngressAudioOptions({
      name: "游戏声音",
      source: TrackSource.SCREEN_SHARE_AUDIO,
    }),
    video: new IngressVideoOptions({
      name: "选手画面",
      source: TrackSource.SCREEN_SHARE,
    }),
  });
}
