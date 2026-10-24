import {
  nativePublications,
  rooms,
  members,
  invites,
  leases,
  bans,
  messages,
  users,
  credentials,
  type Transaction,
} from "@cinegather/database";
import {
  eq,
  and,
  gt,
  isNull,
  isNotNull,
  desc,
  or,
  lt,
  inArray,
  sql,
} from "drizzle-orm";
import { randomUUID, randomBytes } from "node:crypto";
import { db, hash, token, audit, dedup } from "./context";
import { fail, uuid } from "./errors";
import { media } from "./media";
import type { User, RoomInfo, ShareLease } from "@cinegather/contracts";
import { nativeOwner, requireNativeLease } from "./native-authority";
import { config } from "./config";
import { hashRoomPassword, verifyRoomPassword } from "./passwords";

function roomInfo(room: typeof rooms.$inferSelect, userId: string): RoomInfo {
  return {
    id: room.id,
    code: room.code,
    access: room.passwordHash ? "password" : "normal",
    name: room.name,
    ownerUserId: room.ownerUserId,
    maxMembers: room.maxMembers,
    role: room.ownerUserId === userId ? "owner" : "member",
  };
}
const passwordFailures = new Map<string, { count: number; until: number }>();

async function activeSession(tx: Transaction, userId: string) {
  const [session] = await tx
    .select({ id: credentials.id })
    .from(credentials)
    .innerJoin(users, eq(users.id, credentials.userId))
    .where(
      and(
        eq(credentials.userId, userId),
        isNull(credentials.revokedAt),
        eq(credentials.kind, "account"),
        isNotNull(users.username),
        isNull(users.disabledAt),
        gt(credentials.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return session;
}
async function requireActiveSession(tx: Transaction, userId: string) {
  if (!(await activeSession(tx, userId)))
    fail(401, "SESSION_EXPIRED", "登录已失效，请重新登录账号");
}
export async function requireMember(
  tx: Transaction,
  roomId: string,
  userId: string,
  ownerOnly = false,
  lock = false,
): Promise<RoomInfo> {
  roomId = uuid(roomId);
  const query = tx.select().from(rooms).where(eq(rooms.id, roomId));
  const [room] = lock ? await query.for("update") : await query;
  if (!room || room.status !== "active")
    fail(404, "ROOM_NOT_FOUND", "房间不存在或已关闭");
  await requireActiveSession(tx, userId);
  const [ban] = await tx
    .select()
    .from(bans)
    .where(and(eq(bans.roomId, roomId), eq(bans.userId, userId)));
  if (ban) fail(403, "ROOM_BANNED", "你已被此房间禁止加入");
  const [member] = await tx
    .select()
    .from(members)
    .where(and(eq(members.roomId, roomId), eq(members.userId, userId)));
  if (!member || (ownerOnly && room.ownerUserId !== userId))
    fail(403, "FORBIDDEN", "没有此房间的操作权限");
  return roomInfo(room, userId);
}
export async function createRoom(
  user: User,
  input: {
    name: string;
    maxMembers: number;
    access: "normal" | "password";
    password?: string;
  },
  key?: string,
) {
  const passwordHash =
    input.access === "password"
      ? await hashRoomPassword(input.password!)
      : null;
  return db.transaction((tx) =>
    dedup(tx, user.id, key, "room.create", input, async () => {
      await requireActiveSession(tx, user.id);
      const id = randomUUID();
      let created: typeof rooms.$inferSelect | undefined;
      for (let attempt = 0; attempt < 10 && !created; attempt++) {
        const code =
          attempt === 0
            ? id.slice(0, 8).toUpperCase()
            : randomBytes(4).toString("hex").toUpperCase();
        [created] = await tx
          .insert(rooms)
          .values({
            id,
            code,
            ownerUserId: user.id,
            name: input.name,
            maxMembers: input.maxMembers,
            passwordHash,
          })
          .onConflictDoNothing({ target: rooms.code })
          .returning();
      }
      if (!created)
        fail(503, "ROOM_CODE_UNAVAILABLE", "无法生成房间号，请重试");
      await tx.insert(members).values({
        roomId: id,
        userId: user.id,
        role: "owner",
        admittedUntil: new Date(Date.now() + 70_000),
      });
      await tx.insert(leases).values({ roomId: id });
      await audit(tx, user.id, "room.created", id);
      return roomInfo(created, user.id);
    }),
  );
}
export async function getRoom(user: User, roomId: string) {
  return db.transaction((tx) =>
    requireMember(tx, roomId, user.id, false, true),
  );
}
export async function listRooms(user: User) {
  const rows = await db
    .select({
      id: rooms.id,
      code: rooms.code,
      access: sql<
        "normal" | "password"
      >`CASE WHEN ${rooms.passwordHash} IS NULL THEN 'normal' ELSE 'password' END`,
      name: rooms.name,
      ownerUserId: rooms.ownerUserId,
      maxMembers: rooms.maxMembers,
      role: members.role,
    })
    .from(members)
    .innerJoin(rooms, eq(rooms.id, members.roomId))
    .where(and(eq(members.userId, user.id), eq(rooms.status, "active")))
    .orderBy(desc(rooms.createdAt))
    .limit(50);
  return { items: rows };
}
// Count connected humans and seats reserved by issued join tokens once.
// Native publishers use the extra transport slot, not a human admission seat.
async function occupiedUserIds(
  tx: Transaction,
  roomId: string,
  participants: readonly { identity: string }[],
) {
  const admissions = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(eq(members.roomId, roomId), gt(members.admittedUntil, new Date())),
    );
  return new Set([
    ...participants
      .filter((p) => !nativeOwner(p.identity))
      .map((p) => p.identity),
    ...admissions.map((a) => a.userId),
  ]);
}
export async function updateRoomSettings(
  user: User,
  roomId: string,
  input: { name?: string; maxMembers?: number },
) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    const previous = await requireMember(tx, roomId, user.id, true, true);
    const maxMembers = input.maxMembers ?? previous.maxMembers;
    if (maxMembers !== previous.maxMembers) {
      const occupying = await occupiedUserIds(
        tx,
        roomId,
        await media.participants(roomId),
      );
      if (maxMembers < occupying.size)
        fail(
          409,
          "ROOM_CAPACITY_TOO_SMALL",
          `房间内已有 ${occupying.size} 人，人数上限不能低于当前人数`,
        );
      const [transport] = await media.client.listRooms([roomId]);
      if (
        transport?.maxParticipants &&
        transport.maxParticipants < maxMembers + 1
      )
        fail(
          409,
          "ROOM_RECREATE_REQUIRED",
          "这个房间由旧版本创建，暂不支持提高人数上限，请重新创建房间",
        );
    }
    const name = input.name ?? previous.name;
    const [updated] = await tx
      .update(rooms)
      .set({ name, maxMembers })
      .where(eq(rooms.id, roomId))
      .returning();
    if (name !== previous.name || maxMembers !== previous.maxMembers)
      await audit(tx, user.id, "room.updated", roomId, {
        previousName: previous.name,
        name,
        previousMaxMembers: previous.maxMembers,
        maxMembers,
      });
    return roomInfo(updated!, user.id);
  });
}
export async function createInvite(
  user: User,
  roomId: string,
  input: { expiresInHours: number; maxUses: number },
) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true);
    const raw = token();
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3600_000);
    await tx.insert(invites).values({
      id,
      roomId,
      tokenHash: hash(raw),
      createdBy: user.id,
      expiresAt,
      maxUses: input.maxUses,
    });
    await audit(tx, user.id, "invite.created", roomId, { inviteId: id });
    return {
      id,
      token: raw,
      expiresAt: expiresAt.toISOString(),
      maxUses: input.maxUses,
    };
  });
}
export async function revokeInvite(
  user: User,
  roomId: string,
  inviteId: string,
) {
  roomId = uuid(roomId);
  inviteId = uuid(inviteId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true);
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, inviteId), eq(invites.roomId, roomId)));
    await audit(tx, user.id, "invite.revoked", roomId, { inviteId });
  });
  return { ok: true as const };
}
export async function joinRoom(
  user: User,
  roomId: string,
  input: { inviteToken?: string; password?: string } = {},
  clientAddress?: string,
) {
  const reference = roomId.trim();
  const condition = /^[a-f0-9]{8}$/i.test(reference)
    ? eq(rooms.code, reference.toUpperCase())
    : eq(rooms.id, uuid(reference));
  return db.transaction(async (tx) => {
    const [room] = await tx.select().from(rooms).where(condition).for("update");
    if (!room || room.status !== "active")
      fail(404, "ROOM_NOT_FOUND", "房间不存在或已关闭");
    roomId = room.id;
    await requireActiveSession(tx, user.id);
    const [ban] = await tx
      .select()
      .from(bans)
      .where(and(eq(bans.roomId, roomId), eq(bans.userId, user.id)));
    if (ban) fail(403, "ROOM_BANNED", "你已被此房间禁止加入");
    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.roomId, roomId), eq(members.userId, user.id)));
    if (input.inviteToken) {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.roomId, roomId),
            eq(invites.tokenHash, hash(input.inviteToken)),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .for("update");
      if (!invite || (!member && invite.useCount >= invite.maxUses))
        fail(403, "INVITE_INVALID", "邀请无效、已用完或已过期");
      if (!member)
        await tx
          .update(invites)
          .set({ useCount: invite.useCount + 1 })
          .where(eq(invites.id, invite.id));
    } else if (room.passwordHash && room.ownerUserId !== user.id) {
      if (!input.password)
        fail(403, "ROOM_PASSWORD_REQUIRED", "请输入房间密码");
      const key = `${room.id}:${clientAddress ?? user.id}`;
      const now = Date.now();
      if (passwordFailures.size >= 10000) {
        for (const [k, entry] of passwordFailures)
          if (entry.until <= now) passwordFailures.delete(k);
        if (passwordFailures.size >= 10000)
          passwordFailures.delete(passwordFailures.keys().next().value!);
      }
      const previous = passwordFailures.get(key);
      const entry =
        previous && previous.until > now
          ? previous
          : { count: 0, until: now + 60_000 };
      if (entry.count >= 8)
        fail(429, "ROOM_PASSWORD_RATE_LIMITED", "密码尝试过于频繁，请稍后重试");
      if (!(await verifyRoomPassword(input.password, room.passwordHash))) {
        entry.count++;
        passwordFailures.set(key, entry);
        fail(403, "ROOM_PASSWORD_INVALID", "房间密码不正确");
      }
      passwordFailures.delete(key);
    }
    if (!member) {
      await tx
        .insert(members)
        .values({ roomId, userId: user.id, role: "member" });
    }
    await media.ensureRoom(roomId);
    const participants = await media.participants(roomId);
    const occupying = await occupiedUserIds(tx, roomId, participants);
    if (!occupying.has(user.id) && occupying.size >= room.maxMembers)
      fail(409, "ROOM_FULL", "房间人数已满");
    await tx
      .update(members)
      .set({
        admittedUntil: new Date(Date.now() + 70_000),
        joinedAt:
          occupying.has(user.id) && member ? member.joinedAt : new Date(),
      })
      .where(and(eq(members.roomId, roomId), eq(members.userId, user.id)));
    await audit(tx, user.id, "room.joined", roomId);
    return {
      room: roomInfo(room, user.id),
      token: await media.issue(roomId, user),
      url: config.livekitUrl,
    };
  });
}
export async function leaveRoom(user: User, roomId: string) {
  roomId = uuid(roomId);
  await db.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for("update");
    if (!room || room.status === "closed") return;
    await requireMember(tx, roomId, user.id, false, true);
    await revokeNative(tx, roomId, user.id);
    await media.remove(roomId, user.id);
    await tx
      .update(members)
      .set({ admittedUntil: null })
      .where(and(eq(members.roomId, roomId), eq(members.userId, user.id)));
    await tx
      .update(leases)
      .set({ holderUserId: null, leaseId: null, expiresAt: null })
      .where(and(eq(leases.roomId, roomId), eq(leases.holderUserId, user.id)));
    await audit(tx, user.id, "room.left", roomId);
    await settleRoom(tx, roomId, user.id);
  });
  return { ok: true as const };
}
// Caller holds the room lock. Admissions reserve a seat while connecting;
// reconciled live humans retain a short reservation for reconnecting.
export async function settleRoom(
  tx: Transaction,
  roomId: string,
  departedUserId?: string,
  presentUserIds?: string[],
) {
  const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
  if (!room || room.status !== "active") return;
  const knownMembers = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.roomId, roomId));
  const liveHumans = (
    presentUserIds ??
    (await media.participants(roomId, true)).map((p) => p.identity)
  ).filter(
    (identity) =>
      knownMembers.some((m) => m.userId === identity) &&
      identity !== departedUserId,
  );
  if (liveHumans.length)
    await tx
      .update(members)
      .set({ admittedUntil: new Date(Date.now() + 30_000) })
      .where(
        and(
          eq(members.roomId, roomId),
          inArray(members.userId, liveHumans),
          isNotNull(members.admittedUntil),
        ),
      );
  const candidates = await tx
    .select({ userId: members.userId, joinedAt: members.joinedAt })
    .from(members)
    .where(
      and(eq(members.roomId, roomId), gt(members.admittedUntil, new Date())),
    )
    .orderBy(members.joinedAt, members.userId);
  const sessions = candidates.length
    ? await tx
        .select({
          userId: credentials.userId,
          screenShareEnabled: users.screenShareEnabled,
        })
        .from(credentials)
        .innerJoin(users, eq(users.id, credentials.userId))
        .where(
          and(
            inArray(
              credentials.userId,
              candidates.map((c) => c.userId),
            ),
            isNull(credentials.revokedAt),
            eq(credentials.kind, "account"),
            isNotNull(users.username),
            isNull(users.disabledAt),
            gt(credentials.expiresAt, new Date()),
          ),
        )
    : [];
  const eligible = candidates.filter(
    (c) =>
      c.userId !== departedUserId &&
      sessions.some((s) => s.userId === c.userId),
  );
  if (!eligible.length) {
    await closeRoom(tx, roomId);
    await audit(tx, null, "room.closed_empty", roomId);
  } else if (!eligible.some((c) => c.userId === room.ownerUserId)) {
    const owner = (eligible.find((candidate) =>
      liveHumans.includes(candidate.userId),
    ) ?? eligible[0])!.userId;
    await tx
      .update(rooms)
      .set({ ownerUserId: owner })
      .where(eq(rooms.id, roomId));
    await tx
      .update(members)
      .set({ role: "member" })
      .where(eq(members.roomId, roomId));
    await tx
      .update(members)
      .set({ role: "owner" })
      .where(and(eq(members.roomId, roomId), eq(members.userId, owner)));
    await audit(tx, null, "room.owner_transferred", roomId, {
      previousOwner: room.ownerUserId,
      owner,
    });
  }
}
// Caller holds the room row lock. Keep all room teardown paths identical.
export async function closeRoom(tx: Transaction, roomId: string) {
  await revokeNative(tx, roomId);
  await media.deleteRoom(roomId);
  await tx.update(rooms).set({ status: "closed" }).where(eq(rooms.id, roomId));
  await tx
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(eq(invites.roomId, roomId));
  await tx
    .update(leases)
    .set({ holderUserId: null, leaseId: null, expiresAt: null })
    .where(eq(leases.roomId, roomId));
  await tx
    .update(members)
    .set({ admittedUntil: null })
    .where(eq(members.roomId, roomId));
}
function leaseResult(row: typeof leases.$inferSelect): ShareLease {
  return {
    leaseId: row.leaseId!,
    holderUserId: row.holderUserId!,
    expiresAt: row.expiresAt!.toISOString(),
    revision: row.revision,
  };
}
async function requireScreenShare(tx: Transaction, userId: string) {
  const [user] = await tx
    .select({ enabled: users.screenShareEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .for("share");
  if (!user?.enabled)
    fail(403, "SCREEN_SHARE_UNAVAILABLE", "当前账号暂未开通屏幕共享能力");
}
export async function acquireLease(
  user: User,
  roomId: string,
  preempt = false,
) {
  roomId = uuid(roomId);
  let granted = false;
  let previous: { userId: string; leaseId: string } | undefined;
  try {
    const result = await db.transaction(async (tx) => {
      await requireMember(tx, roomId, user.id, preempt, true);
      await requireScreenShare(tx, user.id);
      const participants = await media.participants(roomId);
      if (!participants.some((p) => p.identity === user.id))
        fail(409, "MEDIA_NOT_CONNECTED", "请先连接房间语音");
      const [lease] = await tx
        .select()
        .from(leases)
        .where(eq(leases.roomId, roomId));
      if (!lease) fail(500, "LEASE_MISSING", "房间共享状态不可用");
      if (
        lease.holderUserId &&
        lease.expiresAt &&
        lease.expiresAt.getTime() > Date.now()
      ) {
        if (lease.holderUserId === user.id) return leaseResult(lease);
        if (!preempt) fail(409, "SHARE_BUSY", "已有成员正在共享");
      }
      if (lease.holderUserId && lease.leaseId)
        previous = { userId: lease.holderUserId, leaseId: lease.leaseId };
      await revokeNative(tx, roomId);
      // Revoke first: LiveKit SetPermission removes all tracks from disallowed sources.
      for (const p of participants)
        if (!nativeOwner(p.identity))
          await media.setShare(roomId, p.identity, false);
      await media.setShare(roomId, user.id, true);
      granted = true;
      const next = {
        leaseId: randomUUID(),
        holderUserId: user.id,
        expiresAt: new Date(Date.now() + 30_000),
        revision: lease.revision + 1,
      };
      await tx.update(leases).set(next).where(eq(leases.roomId, roomId));
      await audit(
        tx,
        user.id,
        preempt ? "share.preempted" : "share.acquired",
        roomId,
        {
          previousHolder: previous?.userId,
          revision: next.revision,
        },
      );
      return leaseResult({ roomId, ...next });
    });
    if (previous)
      await notifyShareStopped(roomId, previous.userId, previous.leaseId);
    return result;
  } catch (error) {
    if (granted)
      await media
        .setShare(roomId, user.id, false)
        .catch(() =>
          console.error(
            JSON.stringify({ event: "share.compensation_required", roomId }),
          ),
        );
    throw error;
  }
}
export async function renewLease(
  user: User,
  roomId: string,
  input: { leaseId: string; revision: number },
) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    await requireScreenShare(tx, user.id);
    const [lease] = await tx
      .select()
      .from(leases)
      .where(eq(leases.roomId, roomId));
    if (
      !lease ||
      lease.holderUserId !== user.id ||
      lease.leaseId !== input.leaseId ||
      lease.revision !== input.revision ||
      !lease.expiresAt ||
      lease.expiresAt.getTime() <= Date.now()
    )
      fail(409, "LEASE_LOST", "共享授权已失效，请重新共享");
    if (!(await media.participants(roomId)).some((p) => p.identity === user.id))
      fail(409, "MEDIA_NOT_CONNECTED", "媒体连接已断开");
    const expiresAt = new Date(Date.now() + 30_000);
    await tx.update(leases).set({ expiresAt }).where(eq(leases.roomId, roomId));
    return leaseResult({ ...lease, expiresAt });
  });
}
export async function releaseLease(
  user: User,
  roomId: string,
  input: { leaseId: string; revision: number },
) {
  roomId = uuid(roomId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    const [lease] = await tx
      .select()
      .from(leases)
      .where(eq(leases.roomId, roomId));
    if (
      !lease ||
      lease.revision !== input.revision ||
      (lease.holderUserId !== null &&
        (lease.holderUserId !== user.id || lease.leaseId !== input.leaseId))
    )
      fail(409, "LEASE_LOST", "这次共享已结束");
    if (lease.holderUserId) {
      await revokeNative(tx, roomId, user.id);
      if (
        (await media.participants(roomId)).some((p) => p.identity === user.id)
      )
        await media.setShare(roomId, user.id, false);
      await tx
        .update(leases)
        .set({ holderUserId: null, leaseId: null, expiresAt: null })
        .where(eq(leases.roomId, roomId));
      await audit(tx, user.id, "share.released", roomId, {
        revision: input.revision,
      });
    }
  });
  return { ok: true as const };
}
// Caller holds the room lock. Native identities, historical members, banned and
// expired accounts must never become moderation targets or new room owners.
async function requirePresentMember(
  tx: Transaction,
  roomId: string,
  targetId: string,
) {
  const [member] = await tx
    .select()
    .from(members)
    .where(and(eq(members.roomId, roomId), eq(members.userId, targetId)));
  if (!member) fail(403, "FORBIDDEN", "该用户不是此房间的成员");
  const [banned] = await tx
    .select()
    .from(bans)
    .where(and(eq(bans.roomId, roomId), eq(bans.userId, targetId)));
  if (!member.admittedUntil || banned || !(await activeSession(tx, targetId)))
    fail(409, "MEMBER_NOT_CONNECTED", "该成员已不在当前房间");
  const participant = (await media.participants(roomId)).find(
    (p) => p.identity === targetId,
  );
  if (!participant) fail(409, "MEMBER_NOT_CONNECTED", "该成员已不在当前房间");
  return participant;
}
export async function transferOwner(
  user: User,
  roomId: string,
  targetId: string,
) {
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true, true);
    if (targetId === user.id) fail(400, "ALREADY_OWNER", "你已经是房主");
    await requirePresentMember(tx, roomId, targetId);
    const [room] = await tx
      .update(rooms)
      .set({ ownerUserId: targetId })
      .where(eq(rooms.id, roomId))
      .returning();
    await tx
      .update(members)
      .set({ role: "member" })
      .where(eq(members.roomId, roomId));
    await tx
      .update(members)
      .set({ role: "owner" })
      .where(and(eq(members.roomId, roomId), eq(members.userId, targetId)));
    await audit(tx, user.id, "room.owner_transferred", roomId, {
      previousOwner: user.id,
      owner: targetId,
    });
    return roomInfo(room!, user.id);
  });
}
async function notifyShareStopped(
  roomId: string,
  userId: string,
  leaseId: string,
) {
  // Permissions and ingress revocation are authoritative; notification delivery
  // failure must not turn a committed stop/takeover into an apparent failure.
  await media
    .control(userId, { action: "stop-share", roomId, leaseId })
    .catch(() => {});
}
export async function stopMemberShare(
  user: User,
  roomId: string,
  targetId: string,
) {
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  const stoppedLeaseId = await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true, true);
    await requirePresentMember(tx, roomId, targetId);
    const [lease] = await tx
      .select()
      .from(leases)
      .where(eq(leases.roomId, roomId));
    if (lease?.holderUserId !== targetId || !lease.leaseId)
      fail(409, "SHARE_CHANGED", "该成员的共享已结束或已切换");
    await revokeNative(tx, roomId, targetId);
    await media.setShare(roomId, targetId, false);
    await tx
      .update(leases)
      .set({
        holderUserId: null,
        leaseId: null,
        expiresAt: null,
        revision: lease.revision + 1,
      })
      .where(eq(leases.roomId, roomId));
    await audit(tx, user.id, "share.stopped_by_owner", roomId, {
      userId: targetId,
      leaseId: lease.leaseId,
    });
    return lease.leaseId;
  });
  await notifyShareStopped(roomId, targetId, stoppedLeaseId);
  return { ok: true as const };
}
export async function muteMember(user: User, roomId: string, targetId: string) {
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true, true);
    if (targetId === user.id)
      fail(400, "CANNOT_MODERATE_SELF", "请使用自己的麦克风开关");
    const target = await requirePresentMember(tx, roomId, targetId);
    await media.muteMicrophone(roomId, targetId, target.tracks ?? []);
    await audit(tx, user.id, "member.microphone_muted", roomId, {
      userId: targetId,
    });
  });
  return { ok: true as const };
}
export async function moderate(
  user: User,
  roomId: string,
  targetId: string,
  ban: boolean,
) {
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true, true);
    if (targetId === user.id)
      fail(400, "CANNOT_KICK_OWNER", "房主不能移除自己");
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetId));
    if (!target) fail(404, "USER_NOT_FOUND", "成员不存在");
    await revokeNative(tx, roomId, targetId);
    await media.remove(roomId, targetId);
    await tx
      .delete(members)
      .where(and(eq(members.roomId, roomId), eq(members.userId, targetId)));
    if (ban)
      await tx
        .insert(bans)
        .values({ roomId, userId: targetId })
        .onConflictDoNothing();
    await tx
      .update(leases)
      .set({ holderUserId: null, leaseId: null, expiresAt: null })
      .where(and(eq(leases.roomId, roomId), eq(leases.holderUserId, targetId)));
    await audit(tx, user.id, ban ? "member.banned" : "member.kicked", roomId, {
      userId: targetId,
    });
  });
  return { ok: true as const };
}
export async function unban(user: User, roomId: string, targetId: string) {
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true, true);
    await tx
      .delete(bans)
      .where(and(eq(bans.roomId, roomId), eq(bans.userId, targetId)));
    await audit(tx, user.id, "member.unbanned", roomId, { userId: targetId });
  });
  return { ok: true as const };
}
export async function listBans(user: User, roomId: string) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true);
    return {
      items: await tx
        .select({ userId: users.id, displayName: users.displayName })
        .from(bans)
        .innerJoin(users, eq(users.id, bans.userId))
        .where(eq(bans.roomId, roomId))
        .limit(100),
    };
  });
}
export async function postMessage(
  user: User,
  roomId: string,
  body: string,
  key?: string,
) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id);
    return dedup(tx, user.id, key, `message:${roomId}`, { body }, async () => {
      const id = randomUUID();
      const createdAt = new Date();
      await tx
        .insert(messages)
        .values({ id, roomId, userId: user.id, body, createdAt });
      return {
        id,
        userId: user.id,
        displayName: user.displayName,
        body,
        createdAt: createdAt.toISOString(),
      };
    });
  });
}
export async function getMessages(user: User, roomId: string, cursor?: string) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id);
    let before: typeof messages.$inferSelect | undefined;
    if (cursor) {
      uuid(cursor);
      [before] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, cursor), eq(messages.roomId, roomId)));
      if (!before) fail(400, "INVALID_CURSOR", "无效的消息游标");
    }
    const rows = await tx
      .select({
        id: messages.id,
        userId: messages.userId,
        displayName: users.displayName,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.userId))
      .where(
        and(
          eq(messages.roomId, roomId),
          before
            ? or(
                lt(messages.createdAt, before.createdAt),
                and(
                  eq(messages.createdAt, before.createdAt),
                  lt(messages.id, before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(51);
    const more = rows.length > 50;
    const page = rows.slice(0, 50);
    return {
      items: page
        .reverse()
        .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      nextCursor: more ? page[0]!.id : null,
    };
  });
}
export async function reconcileRoom(roomId: string) {
  roomId = uuid(roomId);
  await db.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for("update");
    if (!room || room.status !== "active") return;
    const [lease] = await tx
      .select()
      .from(leases)
      .where(eq(leases.roomId, roomId));
    const participants = await media.participants(roomId, true);
    const roomMembers = await tx
      .select()
      .from(members)
      .where(eq(members.roomId, roomId));
    const roomBans = await tx
      .select()
      .from(bans)
      .where(eq(bans.roomId, roomId));
    const humanIds = participants
      .filter((p) => roomMembers.some((m) => m.userId === p.identity))
      .map((p) => p.identity);
    const validSessions = humanIds.length
      ? await tx
          .select({
            userId: credentials.userId,
            screenShareEnabled: users.screenShareEnabled,
          })
          .from(credentials)
          .innerJoin(users, eq(users.id, credentials.userId))
          .where(
            and(
              inArray(credentials.userId, humanIds),
              isNull(credentials.revokedAt),
              eq(credentials.kind, "account"),
              isNotNull(users.username),
              isNull(users.disabledAt),
              gt(credentials.expiresAt, new Date()),
            ),
          )
      : [];
    const authorized = (identity: string) =>
      roomMembers.some(
        (m) => m.userId === identity && m.admittedUntil !== null,
      ) &&
      validSessions.some((c) => c.userId === identity) &&
      !roomBans.some((b) => b.userId === identity) &&
      room.status === "active";
    const activeHolder =
      lease?.holderUserId &&
      authorized(lease.holderUserId) &&
      validSessions.some(
        (c) => c.userId === lease.holderUserId && c.screenShareEnabled,
      ) &&
      lease?.expiresAt &&
      lease.expiresAt.getTime() > Date.now() &&
      participants.some((p) => p.identity === lease.holderUserId)
        ? lease.holderUserId
        : null;
    let [publication] = await tx
      .select()
      .from(nativePublications)
      .where(eq(nativePublications.roomId, roomId));
    const validNative =
      publication &&
      activeHolder === publication.holderUserId &&
      publication.leaseId === lease?.leaseId &&
      publication.revision === lease?.revision;
    for (const participant of participants) {
      if (nativeOwner(participant.identity)) {
        if (!validNative || participant.identity !== publication?.identity)
          await media.remove(roomId, participant.identity);
        continue;
      }
      if (!authorized(participant.identity)) {
        await media.remove(roomId, participant.identity);
        continue;
      }
      await tx
        .update(members)
        .set({ admittedUntil: new Date(Date.now() + 30_000) })
        .where(
          and(
            eq(members.roomId, roomId),
            eq(members.userId, participant.identity),
          ),
        );
      const allowsScreen =
        participant.permission?.canPublishSources.includes(3) ||
        participant.permission?.canPublishSources.includes(4);
      const shouldShare = participant.identity === activeHolder && !validNative;
      if (Boolean(allowsScreen) !== shouldShare)
        await media.setShare(roomId, participant.identity, shouldShare);
    }
    if (publication && !validNative) {
      await revokeNative(tx, roomId);
      publication = undefined;
    }
    for (const ingress of await media.ingress.listIngress({
      roomName: roomId,
    })) {
      if (
        ingress.name.startsWith("cinegather/native/v1/") &&
        ingress.ingressId !== publication?.ingressId
      )
        await media.deleteNative(
          roomId,
          ingress.participantIdentity,
          ingress.ingressId,
        );
    }
    if (lease?.holderUserId && !activeHolder) {
      await tx
        .update(leases)
        .set({ holderUserId: null, leaseId: null, expiresAt: null })
        .where(eq(leases.roomId, roomId));
      await audit(tx, null, "share.reconciled", roomId, {
        revision: lease.revision,
      });
    }
    await settleRoom(
      tx,
      roomId,
      undefined,
      participants.filter((p) => authorized(p.identity)).map((p) => p.identity),
    );
  });
}
export async function reconcileAll() {
  const active = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.status, "active"));
  for (const room of active) {
    try {
      await reconcileRoom(room.id);
    } catch {
      console.error(
        JSON.stringify({ event: "room.reconcile_failed", roomId: room.id }),
      );
    }
  }
  // Ingress creation can finish after the business transaction/room is gone.
  // Scan managed keys globally so closed rooms cannot strand usable publishers.
  const activeIds = new Set(active.map((room) => room.id));
  for (const ingress of await media.ingress.listIngress({})) {
    if (
      ingress.name.startsWith("cinegather/native/v1/") &&
      !activeIds.has(ingress.roomName)
    ) {
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, ingress.roomName))
          .for("update");
        if (current?.status === "active") return;
        await media.deleteNative(
          ingress.roomName,
          ingress.participantIdentity,
          ingress.ingressId,
        );
      });
    }
  }
}

export async function revokeNative(
  tx: Transaction,
  roomId: string,
  holderUserId?: string,
) {
  const [publication] = await tx
    .select()
    .from(nativePublications)
    .where(eq(nativePublications.roomId, roomId));
  if (
    !publication ||
    (holderUserId && publication.holderUserId !== holderUserId)
  )
    return;
  await media.deleteNative(roomId, publication.identity, publication.ingressId);
  await tx
    .delete(nativePublications)
    .where(eq(nativePublications.roomId, roomId));
}
export async function nativePublication(
  user: User,
  roomId: string,
  input: { leaseId: string; revision: number },
) {
  roomId = uuid(roomId);
  let created: { ingressId: string; participantIdentity: string } | undefined;
  try {
    return await db.transaction(async (tx) => {
      await requireMember(tx, roomId, user.id, false, true);
      await requireScreenShare(tx, user.id);
      const [lease] = await tx
        .select()
        .from(leases)
        .where(eq(leases.roomId, roomId));
      requireNativeLease(
        lease,
        user.id,
        input,
        (await media.participants(roomId)).some((p) => p.identity === user.id),
      );
      const [existing] = await tx
        .select()
        .from(nativePublications)
        .where(eq(nativePublications.roomId, roomId));
      if (
        existing &&
        (existing.leaseId !== input.leaseId ||
          existing.revision !== input.revision)
      )
        await revokeNative(tx, roomId);
      let ingress =
        existing?.leaseId === input.leaseId &&
        existing.revision === input.revision
          ? (
              await media.ingress.listIngress({ ingressId: existing.ingressId })
            )[0]
          : undefined;
      await media.setShare(roomId, user.id, false);
      if (!ingress) {
        if (existing)
          await tx
            .delete(nativePublications)
            .where(eq(nativePublications.roomId, roomId));
        ingress = await media.createNative(roomId, user, input.leaseId);
        created = ingress;
        await tx.insert(nativePublications).values({
          roomId,
          leaseId: input.leaseId,
          revision: input.revision,
          holderUserId: user.id,
          ingressId: ingress.ingressId,
          identity: ingress.participantIdentity,
        });
      }
      if (!ingress.url || !ingress.streamKey)
        fail(503, "INGRESS_UNAVAILABLE", "原生推流服务未配置，请联系房主");
      return {
        url: ingress.url,
        token: ingress.streamKey,
        identity: ingress.participantIdentity,
        expiresAt: lease!.expiresAt!.toISOString(),
      };
    });
  } catch (error) {
    if (created)
      await media
        .deleteNative(roomId, created.participantIdentity, created.ingressId)
        .catch(() =>
          console.error(
            JSON.stringify({ event: "native.compensation_required", roomId }),
          ),
        );
    throw error;
  }
}
