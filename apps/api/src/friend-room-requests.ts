import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  bans,
  invites,
  members,
  roomJoinRequests,
  rooms,
  users,
  type Transaction,
} from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { audit, db, hash } from "./context";
import { fail, uuid } from "./errors";
import { areAcceptedFriends } from "./friend-access";
import { friendRoomToken } from "./friend-room-invitations";
import { media } from "./media";
import { occupiedUserIds, requireMember } from "./rooms";

async function checkRoom(
  tx: Transaction,
  roomId: string,
  recipientId: string,
  requesterId: string,
) {
  const room = await requireMember(tx, roomId, recipientId, false, true);
  const occupying = await occupiedUserIds(
    tx,
    roomId,
    await media.participants(roomId),
  );
  if (!occupying.has(recipientId))
    fail(409, "FRIEND_LEFT_ROOM", "好友已离开这个房间");
  if (!(await areAcceptedFriends(tx, recipientId, requesterId)))
    fail(403, "FRIEND_REQUIRED", "只能向已成为好友的用户申请加入");
  const [ban] = await tx
    .select({ id: bans.userId })
    .from(bans)
    .where(and(eq(bans.roomId, roomId), eq(bans.userId, requesterId)));
  if (ban) fail(403, "ROOM_BANNED", "你已被此房间禁止加入");
  if (occupying.has(requesterId))
    fail(409, "ALREADY_IN_ROOM", "你已在这个房间");
  if (occupying.size >= room.maxMembers)
    fail(409, "ROOM_FULL", "房间已满，无法加入");
}

export async function requestFriendRoom(user: User, targetId: string) {
  targetId = uuid(targetId);
  if (user.id === targetId) fail(400, "FRIEND_SELF", "不能向自己申请加入");
  return db.transaction(async (tx) => {
    if (!(await areAcceptedFriends(tx, user.id, targetId)))
      fail(403, "FRIEND_REQUIRED", "只能向已成为好友的用户申请加入");
    // Keep hidden-room requests indistinguishable from a friend outside a room.
    // The shared row lock serializes this decision with visibility changes.
    const [visible] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, targetId), eq(users.presenceVisibility, "online")),
      )
      .for("share");
    if (!visible)
      fail(409, "FRIEND_NOT_IN_ROOM", "好友当前不在可申请加入的房间中");
    const [location] = await tx
      .select({ id: rooms.id })
      .from(members)
      .innerJoin(rooms, eq(rooms.id, members.roomId))
      .where(
        and(
          eq(members.userId, targetId),
          gt(members.admittedUntil, new Date()),
          eq(rooms.status, "active"),
        ),
      )
      .orderBy(desc(members.joinedAt), rooms.id)
      .limit(1);
    if (!location) fail(409, "FRIEND_NOT_IN_ROOM", "好友当前不在房间中");
    await checkRoom(tx, location.id, targetId, user.id);
    const [previous] = await tx
      .select()
      .from(roomJoinRequests)
      .where(
        and(
          eq(roomJoinRequests.roomId, location.id),
          eq(roomJoinRequests.requesterId, user.id),
          eq(roomJoinRequests.recipientId, targetId),
        ),
      )
      .orderBy(desc(roomJoinRequests.createdAt))
      .limit(1);
    const now = Date.now();
    if (previous?.status === "pending" && previous.expiresAt.getTime() > now)
      return { id: previous.id, expiresAt: previous.expiresAt.toISOString() };
    if (previous && previous.createdAt.getTime() > now - 60_000)
      fail(429, "ROOM_REQUEST_COOLDOWN", "刚刚已申请过，请稍后重试");
    const id = randomUUID(),
      expiresAt = new Date(now + 5 * 60_000);
    await tx.insert(roomJoinRequests).values({
      id,
      roomId: location.id,
      requesterId: user.id,
      recipientId: targetId,
      expiresAt,
    });
    await audit(tx, user.id, "friend.room_requested", location.id, {
      requestId: id,
      recipientId: targetId,
    });
    return { id, expiresAt: expiresAt.toISOString() };
  });
}

export async function decideRoomRequest(
  user: User,
  requestId: string,
  approve: boolean,
) {
  requestId = uuid(requestId);
  return db.transaction(async (tx) => {
    const condition = and(
      eq(roomJoinRequests.id, requestId),
      eq(roomJoinRequests.recipientId, user.id),
    );
    const [source] = await tx.select().from(roomJoinRequests).where(condition);
    if (!source) fail(404, "ROOM_REQUEST_NOT_FOUND", "此申请不存在或不属于你");
    // Lock rooms before requests, matching room admission and invitation lock order.
    if (approve)
      await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.id, source.roomId))
        .for("update");
    const [current] = await tx
      .select()
      .from(roomJoinRequests)
      .where(condition)
      .for("update");
    if (!current) fail(404, "ROOM_REQUEST_NOT_FOUND", "此申请不存在或不属于你");
    const status = approve ? "approved" : "rejected";
    if (current.status === status) return { ok: true as const };
    if (current.status !== "pending")
      fail(409, "ROOM_REQUEST_HANDLED", "此申请已经处理");
    if (current.expiresAt.getTime() <= Date.now())
      fail(410, "ROOM_REQUEST_EXPIRED", "申请已过期，请让好友重新申请");
    let inviteId: string | undefined;
    if (approve) {
      await checkRoom(tx, current.roomId, user.id, current.requesterId);
      inviteId = randomUUID();
      await tx.insert(invites).values({
        id: inviteId,
        roomId: current.roomId,
        createdBy: user.id,
        recipientId: current.requesterId,
        tokenHash: hash(
          friendRoomToken(inviteId, current.roomId, current.requesterId),
        ),
        maxUses: 1,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
    }
    await tx
      .update(roomJoinRequests)
      .set({ status, inviteId })
      .where(condition);
    await audit(
      tx,
      user.id,
      approve ? "friend.room_request_approved" : "friend.room_request_rejected",
      current.roomId,
      { requestId, requesterId: current.requesterId },
    );
    return { ok: true as const };
  });
}

export async function listRoomJoinRequests(user: User) {
  const r = roomJoinRequests;
  const rows = await db
    .select({
      id: r.id,
      userId: users.id,
      displayName: users.displayName,
      incoming: sql<boolean>`${r.recipientId} = ${user.id}`,
      status: r.status,
      expiresAt: r.expiresAt,
    })
    .from(r)
    .innerJoin(rooms, eq(rooms.id, r.roomId))
    .innerJoin(
      users,
      sql`${users.id} = CASE WHEN ${r.requesterId} = ${user.id} THEN ${r.recipientId} ELSE ${r.requesterId} END`,
    )
    .where(
      and(
        or(
          eq(r.requesterId, user.id),
          and(eq(r.recipientId, user.id), eq(r.status, "pending")),
        ),
        gt(r.expiresAt, new Date()),
        eq(rooms.status, "active"),
        isNull(users.disabledAt),
        sql`EXISTS (SELECT 1 FROM room_members AS recipient WHERE recipient.room_id = ${r.roomId} AND recipient.user_id = ${r.recipientId} AND recipient.admitted_until > NOW())`,
        sql`NOT EXISTS (SELECT 1 FROM room_members AS applicant WHERE applicant.room_id = ${r.roomId} AND applicant.user_id = ${r.requesterId} AND applicant.admitted_until > NOW())`,
        sql`EXISTS (SELECT 1 FROM friendships AS relation WHERE relation.status = 'accepted' AND ((relation.requester_id = ${r.requesterId} AND relation.recipient_id = ${r.recipientId}) OR (relation.requester_id = ${r.recipientId} AND relation.recipient_id = ${r.requesterId})))`,
        sql`NOT EXISTS (SELECT 1 FROM room_bans AS ban WHERE ban.room_id = ${r.roomId} AND ban.user_id = ${r.requesterId})`,
      ),
    )
    .orderBy(desc(r.createdAt))
    .limit(100);
  return rows.map((row) => ({
    ...row,
    status: row.status as "pending" | "approved" | "rejected",
    expiresAt: row.expiresAt.toISOString(),
  }));
}
