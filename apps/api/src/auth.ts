import { revokeNative } from "./rooms";
import { nativePublications, rooms } from "@cinegather/database";
import { users, credentials, members, leases } from "@cinegather/database";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, token, hash, audit } from "./context";
import { fail } from "./errors";
import { media } from "./media";
import type { User } from "@cinegather/contracts";
export async function createGuest(displayName: string) {
  const sessionToken = token();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id, displayName });
    await tx.insert(credentials).values({
      id: randomUUID(),
      userId: id,
      kind: "guest",
      secretHash: hash(sessionToken),
      expiresAt,
    });
    await audit(tx, id, "session.created", id);
  });
  return {
    user: { id, displayName },
    sessionToken,
    expiresAt: expiresAt.toISOString(),
  };
}
export async function authenticate(
  authorization?: string,
): Promise<User & { credentialId: string }> {
  if (!authorization?.startsWith("Bearer ") || authorization.length > 256)
    fail(401, "UNAUTHENTICATED", "请先建立访客身份");
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      credentialId: credentials.id,
    })
    .from(credentials)
    .innerJoin(users, eq(credentials.userId, users.id))
    .where(
      and(
        eq(credentials.secretHash, hash(authorization.slice(7))),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, new Date()),
      ),
    );
  if (!user) fail(401, "SESSION_EXPIRED", "身份已过期，请重新进入");
  return user;
}
export async function revokeSession(authorization: string) {
  const [revoked] = await db
    .update(credentials)
    .set({ revokedAt: new Date() })
    .where(eq(credentials.secretHash, hash(authorization.slice(7))))
    .returning({ userId: credentials.userId });
  if (!revoked) return;
  const affected = new Set([
    ...(
      await db
        .select({ roomId: members.roomId })
        .from(members)
        .where(eq(members.userId, revoked.userId))
    ).map((r) => r.roomId),
    ...(
      await db
        .select({ roomId: nativePublications.roomId })
        .from(nativePublications)
        .where(eq(nativePublications.holderUserId, revoked.userId))
    ).map((r) => r.roomId),
  ]);
  // Serialize with lease issuance and moderation, including an ingress whose
  // external creation has finished while its DB transaction is still pending.
  for (const roomId of [...affected].sort()) {
    await db.transaction(async (tx) => {
      await tx.select().from(rooms).where(eq(rooms.id, roomId)).for("update");
      await revokeNative(tx, roomId, revoked.userId);
      await media.remove(roomId, revoked.userId);
      await tx
        .update(members)
        .set({ admittedUntil: null })
        .where(
          and(eq(members.roomId, roomId), eq(members.userId, revoked.userId)),
        );
      await tx
        .update(leases)
        .set({ holderUserId: null, leaseId: null, expiresAt: null })
        .where(
          and(
            eq(leases.roomId, roomId),
            eq(leases.holderUserId, revoked.userId),
          ),
        );
    });
  }
  for (const room of await media.client.listRooms()) {
    if (
      (await media.participants(room.name)).some(
        (p) => p.identity === revoked.userId,
      )
    )
      await media.remove(room.name, revoked.userId);
  }
  await db.transaction(async (tx) => {
    await audit(tx, revoked.userId, "session.revoked", revoked.userId);
  });
}
