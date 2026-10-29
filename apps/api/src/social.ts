import { friendships, users, credentials } from "@cinegather/database";
import { and, eq, ne, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db, audit } from "./context";
import { fail, uuid } from "./errors";
import type { User } from "@cinegather/contracts";
import { presenceLifetimeMs } from "./presence";
import { listRoomInvitations } from "./friend-room-invitations";
import { listRoomJoinRequests } from "./friend-room-requests";
export async function searchFriend(user: User, username: string) {
  const [target] = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(
      and(
        eq(users.username, username),
        ne(users.id, user.id),
        isNull(users.disabledAt),
        isNotNull(users.passwordHash),
      ),
    )
    .limit(1);
  return { user: target ?? null };
}
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
  const pinnedAt = sql<Date | null>`CASE WHEN ${friendships.requesterId} = ${user.id} THEN ${friendships.requesterPinnedAt} ELSE ${friendships.recipientPinnedAt} END`;
  const online = sql<boolean>`(${friendships.status} = 'accepted' AND ${users.presenceVisibility} = 'online' AND ${users.disabledAt} IS NULL AND EXISTS (
    SELECT 1 FROM ${credentials} WHERE ${credentials.userId} = ${users.id}
    AND ${credentials.kind} = 'account' AND ${credentials.revokedAt} IS NULL
    AND ${credentials.expiresAt} > NOW() AND ${credentials.presenceAt} > ${new Date(Date.now() - presenceLifetimeMs)}
  ))`;
  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      recipientId: friendships.recipientId,
      status: friendships.status,
      userId: users.id,
      displayName: users.displayName,
      remark: sql<string>`CASE WHEN ${friendships.requesterId} = ${user.id} THEN ${friendships.requesterRemark} ELSE ${friendships.recipientRemark} END`,
      pinned: sql<boolean>`${pinnedAt} IS NOT NULL`,
      volume: sql<number>`CASE WHEN ${friendships.requesterId} = ${user.id} THEN ${friendships.requesterVolume} ELSE ${friendships.recipientVolume} END`,
      online,
      // Admission leases exclude departed users and synthetic media publishers.
      room: sql<{
        memberCount: number;
        maxMembers: number;
      } | null>`CASE WHEN ${online} THEN (
        SELECT json_build_object(
          'memberCount', (SELECT count(*)::int FROM room_members AS occupants
            WHERE occupants.room_id = location.room_id AND occupants.admitted_until > NOW()),
          'maxMembers', current_room.max_members)
        FROM room_members AS location
        JOIN rooms AS current_room ON current_room.id = location.room_id
        WHERE location.user_id = ${users.id} AND location.admitted_until > NOW()
          AND current_room.status = 'active'
        ORDER BY location.joined_at DESC, current_room.id
        LIMIT 1
      ) ELSE NULL END`,
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
    .orderBy(sql`${pinnedAt} DESC NULLS LAST`, friendships.createdAt, users.id)
    .limit(100);
  return {
    roomInvitations: await listRoomInvitations(user),
    roomJoinRequests: await listRoomJoinRequests(user),
    items: rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      remark: r.remark,
      pinned: r.pinned,
      volume: r.volume,
      status: r.status as "pending" | "accepted",
      incoming: r.recipientId === user.id,
      online: r.online,
      room: r.room,
    })),
  };
}

export async function updateFriendPreferences(
  user: User,
  targetId: string,
  input: { remark?: string; pinned?: boolean; volume?: number },
) {
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    const pair = or(
      and(
        eq(friendships.requesterId, user.id),
        eq(friendships.recipientId, targetId),
      ),
      and(
        eq(friendships.requesterId, targetId),
        eq(friendships.recipientId, user.id),
      ),
    );
    const [current] = await tx
      .select()
      .from(friendships)
      .where(pair)
      .for("update");
    if (!current || current.status !== "accepted")
      fail(403, "FRIEND_REQUIRED", "只能修改已添加好友的个人设置");
    const requester = current.requesterId === user.id;
    const changes: Partial<typeof friendships.$inferInsert> = {};
    if (input.remark !== undefined)
      changes[requester ? "requesterRemark" : "recipientRemark"] = input.remark;
    if (input.volume !== undefined)
      changes[requester ? "requesterVolume" : "recipientVolume"] = input.volume;
    if (input.pinned !== undefined)
      changes[requester ? "requesterPinnedAt" : "recipientPinnedAt"] =
        input.pinned
          ? ((requester
              ? current.requesterPinnedAt
              : current.recipientPinnedAt) ?? new Date())
          : null;
    await tx.update(friendships).set(changes).where(pair);
    await audit(tx, user.id, "friend.preferences_updated", targetId, {
      remarkChanged: input.remark !== undefined,
      pinChanged: input.pinned !== undefined,
      volumeChanged: input.volume !== undefined,
    });
  });
  return { ok: true as const };
}
