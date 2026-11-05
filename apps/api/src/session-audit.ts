import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { auditLogs, users, rooms, gameSessions } from "@cinegather/database";
import type { AdminQuery } from "@cinegather/contracts";
import { db } from "./context";
import { fail, uuid } from "./errors";
const pattern = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
export async function listSessionEvents(
  kind: "room" | "game",
  id: string,
  query: AdminQuery,
) {
  id = uuid(id);
  const table = kind === "game" ? gameSessions : rooms;
  const [session] = await db
    .select({ name: table.name, code: table.code })
    .from(table)
    .where(eq(table.id, id));
  if (!session)
    fail(
      404,
      "SESSION_NOT_FOUND",
      kind === "game" ? "联机不存在" : "房间不存在",
    );
  const scope =
    kind === "game"
      ? or(
          ilike(auditLogs.action, "game.%"),
          eq(auditLogs.action, "admin.game_closed"),
        )
      : sql`${auditLogs.action} ~ '^(room\\.|member\\.|share\\.|invite\\.|esports\\.|friend\\.room_|admin\\.room_|admin\\.share_)'`;
  const where = and(
    eq(auditLogs.targetId, id),
    scope,
    query.q
      ? or(
          ilike(users.displayName, pattern(query.q)),
          ilike(users.username, pattern(query.q)),
          ilike(auditLogs.action, pattern(query.q)),
          sql`${auditLogs.details}->>'memberName' ilike ${pattern(query.q)}`,
          sql`${auditLogs.details}->>'actorName' ilike ${pattern(query.q)}`,
          sql`${auditLogs.details}->>'reason' ilike ${pattern(query.q)}`,
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorName: users.displayName,
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
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where),
  ]);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  // Historical records can lack display-name snapshots; resolve only explicit member IDs.
  const ids = [
    ...new Set(
      rows
        .map(
          (r) =>
            (r.details as Record<string, unknown>).userId ??
            (r.action === "room.owner_transferred"
              ? (r.details as Record<string, unknown>).owner
              : undefined),
        )
        .filter(
          (x): x is string =>
            typeof x === "string" &&
            /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x),
        ),
    ),
  ];
  const resolved = ids.length
    ? await db
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const names = new Map(resolved.map((u) => [u.id, u.name]));
  return {
    items: rows.map((r) => {
      const d = r.details as Record<string, unknown>;
      return {
        id: r.id,
        action: r.action,
        actorName: text(d.actorName) || r.actorName || "系统",
        sessionName: text(d.targetName) || session.name,
        sessionCode: text(d.targetCode) || session.code,
        memberName:
          text(d.memberName) ||
          names.get(
            text(
              d.userId ??
                (r.action === "room.owner_transferred" ? d.owner : undefined),
            ),
          ) ||
          "",
        reason: text(d.reason),
        createdAt: r.createdAt.toISOString(),
      };
    }),
    total: total!.value,
  };
}
