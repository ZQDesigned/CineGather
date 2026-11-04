import { requireFeatureIdentity } from "./feature-policy";
import {
  emptyFeaturePolicy,
  parseFeatureProtocols,
  type FeaturePolicy,
} from "@cinegather/contracts";
import { trackSourceToString } from "livekit-server-sdk";
import { timingSafeEqual } from "node:crypto";
import { memberIdentity, esportsChannelName } from "@cinegather/contracts";
import { rooms } from "@cinegather/database";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { db } from "./context";
import { fail } from "./errors";
import { esportsScopeSchema, verifyEsportsToken } from "./esports-media";
import { scopeRights } from "./esports";

export function admissionSecretValid(value: string | undefined) {
  const secret = config.esportsAdmissionSecret;
  if (!secret || !value) return false;
  const a = Buffer.from(secret),
    b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function admitMediaToken(
  token: string,
  whileAdmitted: () => Promise<void> = async () => {},
  featurePolicy: () => FeaturePolicy = () => emptyFeaturePolicy,
) {
  let claims;
  try {
    claims = await verifyEsportsToken(token);
  } catch {
    fail(401, "MEDIA_TOKEN_INVALID", "媒体连接授权无效");
  }
  if (!claims.video?.roomJoin || !claims.video.room)
    fail(403, "MEDIA_CHANNEL_DENIED", "媒体连接授权无效");
  return db.transaction(async (tx) => {
    const roomName = claims.video!.room!;
    // Ordinary rooms retain their existing admission. An esports namespace can
    // never downgrade to this path by removing metadata or using another room.
    if (!roomName.startsWith("cg-esports/")) {
      const [parent] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomName))
        .for("share");
      if (parent?.mode !== "esports") return whileAdmitted();
    }
    let scope;
    try {
      scope = esportsScopeSchema.parse(JSON.parse(claims.metadata ?? "{}"));
    } catch {
      fail(403, "MEDIA_SCOPE_REQUIRED", "赛事房需要独立媒体授权");
    }
    if (
      claims.sub !== memberIdentity(scope.userId, scope.credentialId) ||
      roomName !==
        (scope.channel
          ? esportsChannelName(scope.roomId, scope.channel)
          : scope.roomId)
    )
      fail(403, "MEDIA_SCOPE_MISMATCH", "媒体通道与授权不匹配");
    const rights = await scopeRights(tx, scope),
      video = claims.video!;
    if (
      (video.canPublish ?? true) !== rights.publish ||
      (video.canSubscribe ?? true) !== rights.subscribe ||
      video.canPublishData !== false ||
      video.canUpdateOwnMetadata !== false ||
      video.canPublishSources?.length !== rights.sources.length ||
      video.canPublishSources?.some(
        (s) =>
          !rights.sources
            .map(trackSourceToString)
            .some((source) => source === String(s)),
      )
    )
      fail(403, "MEDIA_GRANT_STALE", "媒体权限已变更，请重新连接");
    const [configuration] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, scope.roomId));
    const client = scope.client ?? {
      protocols: parseFeatureProtocols(undefined, "esports-v1,esports-v2"),
    };
    requireFeatureIdentity(
      "room.esports",
      client,
      featurePolicy(),
      configuration?.esportsAdvanced ? 2 : 1,
    );
    if (scope.channel?.kind === "video")
      requireFeatureIdentity(
        rights.publish ? "screen.publish" : "screen.watch",
        client,
        featurePolicy(),
      );
    await whileAdmitted();
  });
}
