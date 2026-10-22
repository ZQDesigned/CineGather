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
import { eq, and, gt, isNull, desc, or, lt, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, hash, token, audit, dedup } from "./context";
import { fail, uuid } from "./errors";
import { media } from "./media";
import type { User, RoomInfo, ShareLease } from "@cinegather/contracts";
import { nativeOwner, requireNativeLease } from "./native-authority";
import { config } from "./config";

async function requireActiveSession(tx: Transaction, userId: string) {
  const [session] = await tx
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, userId),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) fail(401, "SESSION_EXPIRED", "身份已过期，请重新进入");
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
  return {
    id: room.id,
    name: room.name,
    ownerUserId: room.ownerUserId,
    maxMembers: room.maxMembers,
    role: room.ownerUserId === userId ? "owner" : "member",
  };
}
export async function createRoom(
  user: User,
  input: { name: string; maxMembers: number },
  key?: string,
) {
  return db.transaction((tx) =>
    dedup(tx, user.id, key, "room.create", input, async () => {
      const id = randomUUID();
      await tx.insert(rooms).values({ id, ownerUserId: user.id, ...input });
      await tx
        .insert(members)
        .values({ roomId: id, userId: user.id, role: "owner" });
      await tx.insert(leases).values({ roomId: id });
      await audit(tx, user.id, "room.created", id);
      return { id, ownerUserId: user.id, ...input, role: "owner" as const };
    }),
  );
}
export async function getRoom(user: User, roomId: string) {
  return db.transaction((tx) => requireMember(tx, roomId, user.id));
}
export async function listRooms(user: User) {
  const rows = await db
    .select({
      id: rooms.id,
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
  inviteToken?: string,
) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for("update");
    if (!room || room.status !== "active")
      fail(404, "ROOM_NOT_FOUND", "房间不存在或已关闭");
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
    if (!member) {
      if (!inviteToken)
        fail(403, "INVITE_REQUIRED", "加入私密房间需要有效邀请");
      const [invite] = await tx
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.roomId, roomId),
            eq(invites.tokenHash, hash(inviteToken)),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .for("update");
      if (!invite || invite.useCount >= invite.maxUses)
        fail(403, "INVITE_INVALID", "邀请无效、已用完或已过期");
      await tx
        .update(invites)
        .set({ useCount: invite.useCount + 1 })
        .where(eq(invites.id, invite.id));
      await tx
        .insert(members)
        .values({ roomId, userId: user.id, role: "member" });
    }
    await media.ensureRoom(roomId, room.maxMembers);
    const participants = await media.participants(roomId);
    const admissions = await tx
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(eq(members.roomId, roomId), gt(members.admittedUntil, new Date())),
      );
    const occupying = new Set([
      ...participants
        .filter((p) => !nativeOwner(p.identity))
        .map((p) => p.identity),
      ...admissions.map((a) => a.userId),
    ]);
    if (!occupying.has(user.id) && occupying.size >= room.maxMembers)
      fail(409, "ROOM_FULL", "房间人数已满");
    await tx
      .update(members)
      .set({ admittedUntil: new Date(Date.now() + 70_000) })
      .where(and(eq(members.roomId, roomId), eq(members.userId, user.id)));
    await audit(tx, user.id, "room.joined", roomId);
    return {
      room: {
        id: roomId,
        ownerUserId: room.ownerUserId,
        name: room.name,
        maxMembers: room.maxMembers,
        role:
          room.ownerUserId === user.id
            ? ("owner" as const)
            : ("member" as const),
      },
      token: await media.issue(roomId, user),
      url: config.livekitUrl,
    };
  });
}
export async function leaveRoom(user: User, roomId: string) {
  roomId = uuid(roomId);
  await db.transaction(async (tx) => {
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
  });
  return { ok: true as const };
}
function leaseResult(row: typeof leases.$inferSelect): ShareLease {
  return {
    leaseId: row.leaseId!,
    holderUserId: row.holderUserId!,
    expiresAt: row.expiresAt!.toISOString(),
    revision: row.revision,
  };
}
export async function acquireLease(user: User, roomId: string) {
  roomId = uuid(roomId);
  let granted = false;
  try {
    return await db.transaction(async (tx) => {
      await requireMember(tx, roomId, user.id, false, true);
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
        if (lease.holderUserId !== user.id)
          fail(409, "SHARE_BUSY", "已有成员正在共享");
        return leaseResult(lease);
      }
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
      await audit(tx, user.id, "share.acquired", roomId, {
        revision: next.revision,
      });
      return leaseResult({ roomId, ...next });
    });
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
    if (!room) return;
    const [lease] = await tx
      .select()
      .from(leases)
      .where(eq(leases.roomId, roomId));
    const participants = await media.participants(roomId);
    const roomMembers = await tx
      .select()
      .from(members)
      .where(eq(members.roomId, roomId));
    const roomBans = await tx
      .select()
      .from(bans)
      .where(eq(bans.roomId, roomId));
    const validSessions = participants.length
      ? await tx
          .select({ userId: credentials.userId })
          .from(credentials)
          .where(
            and(
              inArray(
                credentials.userId,
                participants.map((p) => p.identity),
              ),
              isNull(credentials.revokedAt),
              gt(credentials.expiresAt, new Date()),
            ),
          )
      : [];
    const authorized = (identity: string) =>
      roomMembers.some((m) => m.userId === identity) &&
      validSessions.some((c) => c.userId === identity) &&
      !roomBans.some((b) => b.userId === identity) &&
      room.status === "active";
    const activeHolder =
      lease?.holderUserId &&
      authorized(lease.holderUserId) &&
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
  });
}
export async function reconcileAll() {
  const active = await db.select({ id: rooms.id }).from(rooms);
  for (const room of active) {
    try {
      await reconcileRoom(room.id);
    } catch {
      console.error(
        JSON.stringify({ event: "room.reconcile_failed", roomId: room.id }),
      );
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
