import { and, eq, ilike, isNotNull, isNull, or, sql, desc } from "drizzle-orm";
import {
  users,
  credentials,
  rooms,
  members,
  leases,
  auditLogs,
  type Transaction,
} from "@cinegather/database";
import type { AdminQuery, User } from "@cinegather/contracts";
import { db, audit } from "./context";
import { fail, uuid } from "./errors";
import { clearUserMedia } from "./auth";
import { closeRoom, revokeNative } from "./rooms";
import { media } from "./media";
const count = sql<number>`count(*)`.mapWith(Number);
const activeCredentials = and(
  eq(credentials.kind, "account"),
  isNull(credentials.revokedAt),
  sql`${credentials.expiresAt}>now()`,
  isNotNull(users.username),
  isNull(users.disabledAt),
);
// Escape LIKE syntax so a search is a literal substring, not a wildcard query.
const pattern = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
async function requireAdmin(tx: Transaction, actor: User) {
  const [current] = await tx
    .select()
    .from(users)
    .where(eq(users.id, actor.id))
    .for("share");
  if (
    !current ||
    current.role !== "admin" ||
    current.disabledAt ||
    !current.username
  )
    fail(403, "ADMIN_REQUIRED", "仅管理员可以执行此操作");
}
export async function overview() {
  const [[accounts], [disabled], [activeRooms], [sessions], available] =
    await Promise.all([
      db.select({ value: count }).from(users).where(isNotNull(users.username)),
      db
        .select({ value: count })
        .from(users)
        .where(and(isNotNull(users.username), isNotNull(users.disabledAt))),
      db.select({ value: count }).from(rooms).where(eq(rooms.status, "active")),
      db
        .select({ value: count })
        .from(credentials)
        .innerJoin(users, eq(users.id, credentials.userId))
        .where(activeCredentials),
      media.client.listRooms().then(
        () => true,
        () => false,
      ),
    ]);
  return {
    accounts: accounts!.value,
    disabledAccounts: disabled!.value,
    activeRooms: activeRooms!.value,
    activeSessions: sessions!.value,
    service: available ? ("available" as const) : ("degraded" as const),
    version: "0.1.0",
  };
}
export async function listUsers(query: AdminQuery) {
  const where = and(
    isNotNull(users.username),
    query.q
      ? or(
          ilike(users.username, pattern(query.q)),
          ilike(users.displayName, pattern(query.q)),
        )
      : undefined,
  );
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        disabledAt: users.disabledAt,
        createdAt: users.createdAt,
        activeSessions:
          sql<number>`(select count(*) from user_credentials uc where uc.user_id="users"."id" and uc.kind='account' and uc.revoked_at is null and uc.expires_at>now())`.mapWith(
            Number,
          ),
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), users.id)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count }).from(users).where(where),
  ]);
  return {
    items: items.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      disabledAt: u.disabledAt?.toISOString() ?? null,
    })),
    total: total!.value,
  };
}
export async function listRooms(query: AdminQuery) {
  const where = query.q
    ? or(
        ilike(rooms.name, pattern(query.q)),
        ilike(rooms.code, pattern(query.q)),
      )
    : undefined;
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: rooms.id,
        code: rooms.code,
        name: rooms.name,
        ownerName: users.displayName,
        status: rooms.status,
        password: sql<boolean>`${rooms.passwordHash} is not null`,
        maxMembers: rooms.maxMembers,
        createdAt: rooms.createdAt,
        memberCount:
          sql<number>`(select count(*) from ${members} where ${members.roomId}=${rooms.id} and ${members.admittedUntil}>now())`.mapWith(
            Number,
          ),
        sharing: sql<boolean>`exists(select 1 from ${leases} where ${leases.roomId}=${rooms.id} and ${leases.holderUserId} is not null and ${leases.expiresAt}>now())`,
      })
      .from(rooms)
      .innerJoin(users, eq(users.id, rooms.ownerUserId))
      .where(where)
      .orderBy(desc(rooms.createdAt), rooms.id)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count }).from(rooms).where(where),
  ]);
  return {
    items: items.map(({ password, ...r }) => ({
      ...r,
      access: password ? ("password" as const) : ("normal" as const),
      createdAt: r.createdAt.toISOString(),
    })),
    total: total!.value,
  };
}
export async function listAudit(query: AdminQuery) {
  const where = and(
    ilike(auditLogs.action, "admin.%"),
    query.q
      ? or(
          ilike(users.displayName, pattern(query.q)),
          ilike(users.username, pattern(query.q)),
          ilike(auditLogs.action, pattern(query.q)),
          sql`${auditLogs.details}->>'targetName' ilike ${pattern(query.q)}`,
        )
      : undefined,
  );
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        actorName: users.displayName,
        action: auditLogs.action,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), auditLogs.id)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: count })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where),
  ]);
  return {
    items: items.map(({ details, ...r }) => {
      const d = details as Record<string, unknown>;
      return {
        ...r,
        actorName: r.actorName ?? "本机管理员命令",
        targetName: typeof d.targetName === "string" ? d.targetName : "",
        reason: typeof d.reason === "string" ? d.reason : "",
        createdAt: r.createdAt.toISOString(),
      };
    }),
    total: total!.value,
  };
}
export async function manageUser(
  actor: User,
  id: string,
  action: "disable" | "enable" | "revoke-sessions",
  reason: string,
) {
  id = uuid(id);
  await db.transaction(async (tx) => {
    const [protectedTarget] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id));
    if (protectedTarget?.role === "admin")
      fail(409, "ADMIN_PROTECTED", "管理员账号请通过本机管理命令维护");
    await requireAdmin(tx, actor);
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    if (!target?.username) fail(404, "USER_NOT_FOUND", "账号不存在");
    if (target.role === "admin")
      fail(409, "ADMIN_PROTECTED", "管理员账号请通过本机管理命令维护");
    if (action !== "revoke-sessions")
      await tx
        .update(users)
        .set({ disabledAt: action === "disable" ? new Date() : null })
        .where(eq(users.id, id));
    if (action !== "enable")
      await tx
        .update(credentials)
        .set({ revokedAt: new Date() })
        .where(and(eq(credentials.userId, id), isNull(credentials.revokedAt)));
    await audit(tx, actor.id, `admin.user_${action.replaceAll("-", "_")}`, id, {
      targetName: target.username,
      reason,
    });
  });
  // Revocation commits before external media cleanup, so tokens remain invalid if SFU is unavailable.
  // Retrying the same action retries cleanup; reconciliation also removes invalid publishers.
  if (action !== "enable") await clearUserMedia(id);
  return { ok: true as const };
}
export async function manageRoom(
  actor: User,
  id: string,
  action: "close" | "revoke-share",
  reason: string,
) {
  id = uuid(id);
  await db.transaction(async (tx) => {
    await requireAdmin(tx, actor);
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, id))
      .for("update");
    if (!room) fail(404, "ROOM_NOT_FOUND", "房间不存在");
    if (room.status !== "active") return;
    if (action === "close") await closeRoom(tx, id);
    else {
      const [lease] = await tx
        .select()
        .from(leases)
        .where(eq(leases.roomId, id));
      await revokeNative(tx, id);
      if (
        lease?.holderUserId &&
        (await media.participants(id, true)).some(
          (p) => p.identity === lease.holderUserId,
        )
      )
        await media.setShare(id, lease.holderUserId, false);
      await tx
        .update(leases)
        .set({ holderUserId: null, leaseId: null, expiresAt: null })
        .where(eq(leases.roomId, id));
    }
    await audit(
      tx,
      actor.id,
      action === "close" ? "admin.room_closed" : "admin.share_revoked",
      id,
      { targetName: `${room.name} (${room.code})`, reason },
    );
  });
  return { ok: true as const };
}
