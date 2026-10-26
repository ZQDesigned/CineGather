import {
  invites,
  rooms,
  users,
  members,
  bans,
  friendships,
} from "@cinegather/database";
import { and, eq, isNull, gt, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, hash, audit } from "./context";
import { fail, uuid } from "./errors";
import { requireMember, occupiedUserIds } from "./rooms";
import { media } from "./media";
import { areAcceptedFriends } from "./friend-access";
import type { User } from "@cinegather/contracts";

// A domain-separated HMAC reconstructs the recipient's token for authenticated
// inbox delivery. The database retains only the usual token hash.
export const friendRoomToken = (
  id: string,
  roomId: string,
  recipientId: string,
) => hash(`friend-room-invitation:v1:${id}:${roomId}:${recipientId}`);

export async function inviteFriendToRoom(
  user: User,
  roomId: string,
  targetId: string,
) {
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  if (user.id === targetId) fail(400, "FRIEND_SELF", "不能邀请自己");
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    const occupying = await occupiedUserIds(
      tx,
      roomId,
      await media.participants(roomId),
    );
    if (!occupying.has(user.id))
      fail(403, "ROOM_MEMBERSHIP_REQUIRED", "请先进入房间再邀请好友");
    if (!(await areAcceptedFriends(tx, user.id, targetId)))
      fail(403, "FRIEND_REQUIRED", "只能邀请已成为好友的用户");
    if (occupying.has(targetId))
      fail(409, "ALREADY_IN_ROOM", "好友已在这个房间");
    const [ban] = await tx
      .select()
      .from(bans)
      .where(and(eq(bans.roomId, roomId), eq(bans.userId, targetId)));
    if (ban) fail(403, "FRIEND_ROOM_BANNED", "该好友已被此房间禁止加入");
    const [previous] = await tx
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.roomId, roomId),
          eq(invites.createdBy, user.id),
          eq(invites.recipientId, targetId),
        ),
      )
      .orderBy(desc(invites.createdAt))
      .limit(1);
    const now = Date.now();
    if (
      previous &&
      !previous.revokedAt &&
      previous.expiresAt.getTime() > now &&
      previous.useCount < previous.maxUses
    )
      return { id: previous.id, expiresAt: previous.expiresAt.toISOString() };
    if (previous && previous.createdAt.getTime() > now - 60_000)
      fail(429, "FRIEND_INVITE_COOLDOWN", "刚刚已邀请过这位好友，请稍后重试");
    const id = randomUUID(),
      expiresAt = new Date(now + 10 * 60_000);
    await tx.insert(invites).values({
      id,
      roomId,
      recipientId: targetId,
      tokenHash: hash(friendRoomToken(id, roomId, targetId)),
      createdBy: user.id,
      expiresAt,
      maxUses: 1,
    });
    await audit(tx, user.id, "friend.room_invited", roomId, {
      inviteId: id,
      recipientId: targetId,
    });
    return { id, expiresAt: expiresAt.toISOString() };
  });
}

export async function listRoomInvitations(user: User) {
  const rows = await db
    .select({
      id: invites.id,
      roomId: rooms.id,
      roomName: rooms.name,
      senderId: users.id,
      senderName: users.displayName,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .innerJoin(rooms, eq(rooms.id, invites.roomId))
    .innerJoin(users, eq(users.id, invites.createdBy))
    .where(
      and(
        eq(invites.recipientId, user.id),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
        sql`${invites.useCount} < ${invites.maxUses}`,
        eq(rooms.status, "active"),
        isNull(users.disabledAt),
        sql`EXISTS (SELECT 1 FROM ${friendships} WHERE ${friendships.status} = 'accepted' AND ((${friendships.requesterId} = ${user.id} AND ${friendships.recipientId} = ${invites.createdBy}) OR (${friendships.requesterId} = ${invites.createdBy} AND ${friendships.recipientId} = ${user.id})))`,
        sql`NOT EXISTS (SELECT 1 FROM ${bans} WHERE ${bans.roomId} = ${invites.roomId} AND ${bans.userId} = ${user.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${members} WHERE ${members.roomId} = ${invites.roomId} AND ${members.userId} = ${user.id} AND ${members.admittedUntil} > NOW())`,
      ),
    )
    .orderBy(desc(invites.createdAt))
    .limit(50);
  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    token: friendRoomToken(row.id, row.roomId, user.id),
  }));
}

export async function dismissRoomInvitation(user: User, inviteId: string) {
  const rows = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(invites.id, uuid(inviteId)), eq(invites.recipientId, user.id)),
    )
    .returning({ id: invites.id });
  if (!rows.length) fail(404, "INVITE_NOT_FOUND", "此邀请不存在或不属于你");
  return { ok: true as const };
}
