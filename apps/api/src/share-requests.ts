import { randomUUID } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import {
  shareRequests,
  leases,
  credentials,
  roomMemberPermissions,
  users,
  type Transaction,
} from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { db } from "./context";
import { fail, uuid } from "./errors";
import { requireMember, requireScreenShare } from "./rooms";
import { media } from "./media";
import { sessionCredential } from "./session-context";
export async function queueRows(tx: Transaction, roomId: string) {
  const [lease] = await tx
    .select()
    .from(leases)
    .where(eq(leases.roomId, roomId));
  const peers = await media.participants(roomId);
  const rows = await tx
    .select({
      request: shareRequests,
      revokedAt: credentials.revokedAt,
      credentialExpires: credentials.expiresAt,
      enabled: users.screenShareEnabled,
      disabled: users.disabledAt,
      sharingAllowed: roomMemberPermissions.sharingAllowed,
    })
    .from(shareRequests)
    .innerJoin(credentials, eq(credentials.id, shareRequests.credentialId))
    .innerJoin(users, eq(users.id, shareRequests.userId))
    .leftJoin(
      roomMemberPermissions,
      and(
        eq(roomMemberPermissions.roomId, roomId),
        eq(roomMemberPermissions.userId, shareRequests.userId),
      ),
    )
    .where(eq(shareRequests.roomId, roomId))
    .orderBy(asc(shareRequests.createdAt), asc(shareRequests.id));
  for (const {
    request: r,
    revokedAt,
    credentialExpires,
    enabled,
    disabled,
    sharingAllowed,
  } of rows) {
    if (
      !lease?.leaseId ||
      !lease.expiresAt ||
      lease.expiresAt.getTime() <= Date.now() ||
      lease.leaseId !== r.leaseId ||
      lease.revision !== r.revision ||
      r.expiresAt.getTime() <= Date.now() ||
      revokedAt ||
      !enabled ||
      disabled ||
      sharingAllowed === false ||
      credentialExpires.getTime() <= Date.now() ||
      !peers.some(
        (p) =>
          p.identity === r.userId &&
          (!p.rawIdentity || p.rawIdentity.endsWith("/" + r.credentialId)),
      )
    )
      await tx.delete(shareRequests).where(eq(shareRequests.id, r.id));
  }
  return {
    lease,
    rows: await tx
      .select({
        id: shareRequests.id,
        userId: shareRequests.userId,
        credentialId: shareRequests.credentialId,
        displayName: users.displayName,
        status: shareRequests.status,
        createdAt: shareRequests.createdAt,
        expiresAt: shareRequests.expiresAt,
      })
      .from(shareRequests)
      .innerJoin(users, eq(users.id, shareRequests.userId))
      .where(eq(shareRequests.roomId, roomId))
      .orderBy(asc(shareRequests.createdAt), asc(shareRequests.id)),
  };
}
export async function readQueue(user: User, roomId: string) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    const { rows } = await queueRows(tx, roomId);
    return {
      items: rows.map(({ credentialId, ...r }) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        current: credentialId === sessionCredential(user),
      })),
    };
  });
}
export async function requestShare(user: User, roomId: string) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    await requireScreenShare(tx, user.id, roomId);
    const { lease, rows } = await queueRows(tx, roomId);
    if (
      !lease?.holderUserId ||
      !lease.leaseId ||
      !lease.expiresAt ||
      lease.expiresAt.getTime() <= Date.now()
    )
      fail(409, "SHARE_CHANGED", "当前没有正在进行的共享，请直接开始共享");
    if (lease.holderUserId === user.id)
      fail(409, "ALREADY_SHARING", "你已经在共享");
    const credentialId = sessionCredential(user)!;
    if (
      !(await media.participants(roomId)).some(
        (p) =>
          p.identity === user.id && p.rawIdentity?.endsWith("/" + credentialId),
      )
    )
      fail(409, "MEDIA_NOT_CONNECTED", "请先连接房间");
    const existing = rows.find((r) => r.userId === user.id);
    if (existing) {
      if (existing.credentialId !== credentialId)
        fail(
          409,
          "SHARE_REQUEST_OTHER_DEVICE",
          "你已在另一台设备申请接棒，请在该设备继续操作",
        );
      return { ok: true as const };
    }
    await tx.insert(shareRequests).values({
      id: randomUUID(),
      roomId,
      userId: user.id,
      credentialId,
      leaseId: lease.leaseId,
      revision: lease.revision,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    return { ok: true as const };
  });
}
export async function cancelShareRequest(user: User, roomId: string) {
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    await tx
      .delete(shareRequests)
      .where(
        and(
          eq(shareRequests.roomId, roomId),
          eq(shareRequests.credentialId, sessionCredential(user)!),
        ),
      );
    return { ok: true as const };
  });
}
export async function decideShareRequest(
  user: User,
  roomId: string,
  requestId: string,
  approve: boolean,
) {
  roomId = uuid(roomId);
  requestId = uuid(requestId);
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    const { lease, rows } = await queueRows(tx, roomId);
    if (
      lease?.holderUserId !== user.id ||
      lease.credentialId !== sessionCredential(user)
    )
      fail(403, "FORBIDDEN", "仅当前共享者可以处理接棒申请");
    const request = rows.find((r) => r.id === requestId);
    if (!request) fail(409, "SHARE_REQUEST_EXPIRED", "接棒申请已失效");
    if (approve) {
      if (rows[0]?.id !== request.id)
        fail(409, "SHARE_QUEUE_ORDER", "请先处理排在前面的申请");
      await requireScreenShare(tx, request.userId, roomId);
      await tx
        .update(shareRequests)
        .set({ status: "approved", expiresAt: new Date(Date.now() + 60_000) })
        .where(eq(shareRequests.id, request.id));
    } else
      await tx.delete(shareRequests).where(eq(shareRequests.id, request.id));
    return { ok: true as const };
  });
}
