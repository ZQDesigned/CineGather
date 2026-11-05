import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { gameSessions, gameMembers, users } from "@cinegather/database";
import type { AdminGameQuery, AdminQuery, User } from "@cinegather/contracts";
import { db, audit } from "./context";
import { requireManagement } from "./access";
import { endGameInTx, gameTransaction } from "./game-link-access";
import { fail, uuid } from "./errors";
const count = sql<number>`count(*)`.mapWith(Number);
const pattern = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
export async function listGames(query: AdminGameQuery) {
  await gameTransaction(async () => {});
  const where = and(
    query.status === "active"
      ? ne(gameSessions.status, "ended")
      : query.status === "ended"
        ? eq(gameSessions.status, "ended")
        : undefined,
    query.q
      ? or(
          ilike(gameSessions.name, pattern(query.q)),
          ilike(gameSessions.code, pattern(query.q)),
          ilike(users.displayName, pattern(query.q)),
          ilike(users.username, pattern(query.q)),
        )
      : undefined,
  );
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: gameSessions.id,
        name: gameSessions.name,
        code: gameSessions.code,
        game: gameSessions.game,
        gameVersion: gameSessions.gameVersion,
        hostUserId: gameSessions.hostUserId,
        hostName: users.displayName,
        hostUsername: users.username,
        status: gameSessions.status,
        maxMembers: gameSessions.maxMembers,
        memberCount:
          sql<number>`(select count(*) from ${gameMembers} where ${gameMembers.sessionId}=${gameSessions.id} and ${gameMembers.active}=true)`.mapWith(
            Number,
          ),
        createdAt: gameSessions.createdAt,
        endedAt: gameSessions.endedAt,
      })
      .from(gameSessions)
      .innerJoin(users, eq(users.id, gameSessions.hostUserId))
      .where(where)
      .orderBy(desc(gameSessions.createdAt), gameSessions.id)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: count })
      .from(gameSessions)
      .innerJoin(users, eq(users.id, gameSessions.hostUserId))
      .where(where),
  ]);
  return {
    items: items.map((r) => ({
      ...r,
      hostUsername: r.hostUsername ?? "",
      createdAt: r.createdAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
    })),
    total: total!.value,
  };
}
export async function listGameMembers(id: string, query: AdminQuery) {
  id = uuid(id);
  const [session] = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(eq(gameSessions.id, id));
  if (!session) fail(404, "GAME_NOT_FOUND", "联机不存在");
  const where = and(
    eq(gameMembers.sessionId, id),
    query.q
      ? or(
          ilike(users.displayName, pattern(query.q)),
          ilike(users.username, pattern(query.q)),
        )
      : undefined,
  );
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: gameMembers.id,
        userId: gameMembers.userId,
        displayName: users.displayName,
        username: users.username,
        role: gameMembers.role,
        status: gameMembers.status,
        active: gameMembers.active,
        route: gameMembers.route,
        createdAt: gameMembers.createdAt,
      })
      .from(gameMembers)
      .innerJoin(users, eq(users.id, gameMembers.userId))
      .where(where)
      .orderBy(
        desc(gameMembers.active),
        desc(gameMembers.createdAt),
        gameMembers.id,
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: count })
      .from(gameMembers)
      .innerJoin(users, eq(users.id, gameMembers.userId))
      .where(where),
  ]);
  return {
    items: items.map((r) => ({
      ...r,
      username: r.username ?? "",
      createdAt: r.createdAt.toISOString(),
    })),
    total: total!.value,
  };
}
export async function closeGame(actor: User, id: string, reason: string) {
  id = uuid(id);
  await gameTransaction(async (tx) => {
    await requireManagement(tx, actor.id, "games.manage");
    const [session] = await tx
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, id));
    if (!session) fail(404, "GAME_NOT_FOUND", "联机不存在");
    if (session.status === "ended") return;
    await endGameInTx(tx, id, "admin_closed", actor.id);
    await audit(tx, actor.id, "admin.game_closed", id, { reason });
  });
  return { ok: true as const };
}
