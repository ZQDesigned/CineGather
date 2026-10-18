import { friendships, users } from "@cinegather/database";
import { and, eq, or, sql } from "drizzle-orm";
import { db, audit } from "./context";
import { fail, uuid } from "./errors";
import type { User } from "@cinegather/contracts";
export async function requestFriend(user: User, targetId: string) {
  targetId = uuid(targetId);
  if (user.id === targetId) fail(400, "FRIEND_SELF", "不能添加自己为好友");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${[user.id, targetId].sort().join(":")}, 1))`,
    );
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetId));
    if (!target) fail(404, "USER_NOT_FOUND", "此用户不存在");
    const [existing] = await tx
      .select()
      .from(friendships)
      .where(
        or(
          and(
            eq(friendships.requesterId, user.id),
            eq(friendships.recipientId, targetId),
          ),
          and(
            eq(friendships.requesterId, targetId),
            eq(friendships.recipientId, user.id),
          ),
        ),
      );
    if (existing) return;
    await tx
      .insert(friendships)
      .values({ requesterId: user.id, recipientId: targetId });
    await audit(tx, user.id, "friend.requested", targetId);
  });
  return { ok: true as const };
}
export async function acceptFriend(user: User, targetId: string) {
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(friendships)
      .set({ status: "accepted" })
      .where(
        and(
          eq(friendships.requesterId, targetId),
          eq(friendships.recipientId, user.id),
        ),
      )
      .returning();
    if (!rows.length) fail(404, "REQUEST_NOT_FOUND", "没有对应的好友请求");
    await audit(tx, user.id, "friend.accepted", targetId);
  });
  return { ok: true as const };
}
export async function removeFriend(user: User, targetId: string) {
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(friendships)
      .where(
        or(
          and(
            eq(friendships.requesterId, user.id),
            eq(friendships.recipientId, targetId),
          ),
          and(
            eq(friendships.requesterId, targetId),
            eq(friendships.recipientId, user.id),
          ),
        ),
      )
      .returning();
    if (removed.length) await audit(tx, user.id, "friend.removed", targetId);
  });
  return { ok: true as const };
}
export async function listFriends(user: User) {
  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      recipientId: friendships.recipientId,
      status: friendships.status,
      userId: users.id,
      displayName: users.displayName,
    })
    .from(friendships)
    .innerJoin(
      users,
      sql`${users.id} = CASE WHEN ${friendships.requesterId} = ${user.id} THEN ${friendships.recipientId} ELSE ${friendships.requesterId} END`,
    )
    .where(
      or(
        eq(friendships.requesterId, user.id),
        eq(friendships.recipientId, user.id),
      ),
    )
    .limit(100);
  return {
    items: rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      status: r.status as "pending" | "accepted",
      incoming: r.recipientId === user.id,
    })),
  };
}
