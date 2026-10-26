import { revokeNative, settleRoom } from "./rooms";
import { nativePublications, rooms } from "@cinegather/database";
import { users, credentials, members, leases } from "@cinegather/database";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, hash, audit } from "./context";
import { fail } from "./errors";
import { media } from "./media";
import { readAccess } from "./access";
import type { User } from "@cinegather/contracts";
export async function authenticate(
  authorization?: string,
): Promise<User & { credentialId: string }> {
  if (!authorization?.startsWith("Bearer ") || authorization.length > 256)
    fail(401, "UNAUTHENTICATED", "请先登录");
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      isSuperAdmin: users.isSuperAdmin,
      screenShareEnabled: users.screenShareEnabled,
      disabledAt: users.disabledAt,
      kind: credentials.kind,
      revokedAt: credentials.revokedAt,
      expiresAt: credentials.expiresAt,
      credentialId: credentials.id,
      presenceAt: credentials.presenceAt,
    })
    .from(credentials)
    .innerJoin(users, eq(credentials.userId, users.id))
    .where(eq(credentials.secretHash, hash(authorization.slice(7))));
  if (!user) fail(401, "SESSION_EXPIRED", "登录已失效，请重新登录账号");
  if (!user.username || user.kind !== "account")
    fail(401, "ACCOUNT_REQUIRED", "访客模式已关闭，请注册或登录账号");
  if (user.disabledAt)
    fail(401, "ACCOUNT_DISABLED", "账号已停用，请联系管理员");
  if (user.revokedAt || user.expiresAt.getTime() <= Date.now())
    fail(401, "SESSION_EXPIRED", "登录已失效，请重新登录账号");
  // Older clients already make authenticated requests but have no heartbeat
  // endpoint yet. Count their live activity too, without writing on every poll.
  if (!user.presenceAt || user.presenceAt.getTime() < Date.now() - 15_000)
    await db
      .update(credentials)
      .set({ presenceAt: new Date() })
      .where(
        and(
          eq(credentials.id, user.credentialId),
          isNull(credentials.revokedAt),
        ),
      );
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    screenShareEnabled: user.screenShareEnabled,
    ...(await readAccess(db, user.id, user.isSuperAdmin)),
    credentialId: user.credentialId,
  };
}
export async function revokeSession(authorization: string) {
  const [revoked] = await db
    .update(credentials)
    .set({ revokedAt: new Date() })
    .where(eq(credentials.secretHash, hash(authorization.slice(7))))
    .returning({ userId: credentials.userId });
  if (!revoked) return;
  const [other] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, revoked.userId),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!other) await clearUserMedia(revoked.userId);
  await db.transaction(async (tx) => {
    await audit(tx, revoked.userId, "session.revoked", revoked.userId);
  });
}
export async function clearUserMedia(userId: string) {
  const affected = new Set([
    ...(
      await db
        .select({ roomId: members.roomId })
        .from(members)
        .where(eq(members.userId, userId))
    ).map((r) => r.roomId),
    ...(
      await db
        .select({ roomId: nativePublications.roomId })
        .from(nativePublications)
        .where(eq(nativePublications.holderUserId, userId))
    ).map((r) => r.roomId),
  ]);
  // Serialize with lease issuance and moderation, including an ingress whose
  // external creation has finished while its DB transaction is still pending.
  for (const roomId of [...affected].sort()) {
    await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .for("update");
      if (!room || room.status !== "active") return;
      await revokeNative(tx, roomId, userId);
      await media.remove(roomId, userId);
      await tx
        .update(members)
        .set({ admittedUntil: null })
        .where(and(eq(members.roomId, roomId), eq(members.userId, userId)));
      await tx
        .update(leases)
        .set({ holderUserId: null, leaseId: null, expiresAt: null })
        .where(and(eq(leases.roomId, roomId), eq(leases.holderUserId, userId)));
      await settleRoom(tx, roomId, userId);
    });
  }
  for (const room of await media.client.listRooms()) {
    if (
      (await media.participants(room.name)).some((p) => p.identity === userId)
    )
      await media.remove(room.name, userId);
  }
}
