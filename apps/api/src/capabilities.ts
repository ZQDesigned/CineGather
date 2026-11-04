import { eq } from "drizzle-orm";
import {
  users,
  leases,
  nativePublications,
  type Transaction,
} from "@cinegather/database";
import type {
  AdminCapabilitiesInput,
  AdminPermission,
  Quality,
  User,
} from "@cinegather/contracts";
import { db, audit } from "./context";
import { requireManagement } from "./access";
import { fail, uuid } from "./errors";
import { reconcileRoom } from "./rooms";

const permissions = {
  screenShareEnabled: "users.screen-share",
  gameHostEnabled: "users.game-host",
  esportsRoomsEnabled: "users.esports",
  highFrameRateEnabled: "users.high-frame-rate",
  standardRoomMaxMembers: "users.room-capacity",
} as const satisfies Record<string, AdminPermission>;

export async function requireShareQuality(
  tx: Transaction,
  userId: string,
  quality: string,
) {
  const [user] = await tx
    .select({ enabled: users.highFrameRateEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .for("share");
  if (quality === "game" && !user?.enabled)
    fail(
      403,
      "HIGH_FRAME_RATE_UNAVAILABLE",
      "当前账号尚未开通 1080p60 共享，请选择其他画质",
    );
}

export async function validatePublicationQuality(
  tx: Transaction,
  userId: string,
  stored: string,
  requested?: Quality,
) {
  await requireShareQuality(tx, userId, requested ?? stored);
  if (requested && requested !== stored)
    fail(409, "SHARE_QUALITY_CHANGED", "共享画质已变化，请停止后重新共享");
}

export async function reconcileScreenShareAccount(userId: string) {
  const affected = new Set([
    ...(
      await db
        .select({ roomId: leases.roomId })
        .from(leases)
        .where(eq(leases.holderUserId, userId))
    ).map((r) => r.roomId),
    ...(
      await db
        .select({ roomId: nativePublications.roomId })
        .from(nativePublications)
        .where(eq(nativePublications.holderUserId, userId))
    ).map((r) => r.roomId),
  ]);
  for (const id of [...affected].sort()) await reconcileRoom(id);
}

export async function setCapabilities(
  actor: User,
  userId: string,
  input: AdminCapabilitiesInput,
) {
  userId = uuid(userId);
  await db.transaction(async (tx) => {
    const keys = (
      Object.keys(permissions) as (keyof typeof permissions)[]
    ).filter((k) => input[k] !== undefined);
    for (const key of keys)
      await requireManagement(tx, actor.id, permissions[key]);
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!target?.username) fail(404, "USER_NOT_FOUND", "账号不存在");
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const patch: Partial<typeof users.$inferInsert> = {};
    for (const key of keys)
      if (target[key] !== input[key]) {
        Object.assign(patch, { [key]: input[key] });
        changes[key] = { before: target[key], after: input[key] };
      }
    if (Object.keys(changes).length) {
      await tx.update(users).set(patch).where(eq(users.id, userId));
      await audit(tx, actor.id, "admin.capabilities_updated", userId, {
        reason: input.reason,
        changes,
      });
    }
  });
  if (input.screenShareEnabled === false)
    await reconcileScreenShareAccount(userId);
  return { ok: true as const };
}
