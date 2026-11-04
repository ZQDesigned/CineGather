import { and, eq, gt, isNull, ne, sql, inArray, or, lte } from "drizzle-orm";
import {
  credentials,
  users,
  gameSessions,
  gameMembers,
  gameJoinRequests,
  gameInvites,
  type Transaction,
} from "@cinegather/database";
import { GAME_RESERVATION_MS, type User } from "@cinegather/contracts";
import { db, audit } from "./context";
import { fail, uuid } from "./errors";
import { sessionCredential } from "./session-context";
import { boundFeatureClient, requireFeature } from "./feature-policy";

export const gameMutationLock = 839222;
export function requireGameDesktop(user: User) {
  const identity = boundFeatureClient(user);
  if (
    identity &&
    identity.platform !== "win32" &&
    identity.platform !== "darwin"
  )
    fail(403, "GAME_DESKTOP_REQUIRED", "请使用映聚桌面客户端进行游戏联机");
  requireFeature(user, "game.minecraft-java");
}
export async function activeGameCredential(
  tx: Transaction,
  userId: string,
  credentialId: string,
) {
  const [user] = await tx
    .select({ id: users.id, gameHostEnabled: users.gameHostEnabled })
    .from(credentials)
    .innerJoin(users, eq(credentials.userId, users.id))
    .where(
      and(
        eq(credentials.id, credentialId),
        eq(users.id, userId),
        eq(credentials.kind, "account"),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, new Date()),
        isNull(users.disabledAt),
      ),
    )
    .for("share");
  return user;
}
export async function requireGameAccount(tx: Transaction, user: User) {
  const credentialId = sessionCredential(user);
  if (!credentialId) fail(401, "SESSION_EXPIRED", "请重新登录后使用游戏联机");
  const active = await activeGameCredential(tx, user.id, credentialId);
  if (!active) fail(401, "SESSION_EXPIRED", "登录已失效，请重新登录");
  return { ...active, credentialId };
}
export async function endGameInTx(
  tx: Transaction,
  sessionId: string,
  reason: string,
) {
  const [ended] = await tx
    .update(gameSessions)
    .set({
      status: "ended",
      endedAt: new Date(),
      revision: sql`${gameSessions.revision}+1`,
    })
    .where(
      and(eq(gameSessions.id, sessionId), ne(gameSessions.status, "ended")),
    )
    .returning();
  if (!ended) return;
  await tx
    .update(gameMembers)
    .set({
      active: false,
      status: "left",
      route: null,
      tunnelSecretHash: null,
      revision: sql`${gameMembers.revision}+1`,
    })
    .where(
      and(eq(gameMembers.sessionId, sessionId), eq(gameMembers.active, true)),
    );
  await tx
    .update(gameJoinRequests)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(gameJoinRequests.sessionId, sessionId),
        eq(gameJoinRequests.status, "pending"),
      ),
    );
  await tx
    .update(gameInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(gameInvites.sessionId, sessionId), isNull(gameInvites.revokedAt)),
    );
  await audit(tx, ended.hostUserId, "game.ended", sessionId, { reason });
}
export async function reconcileGamesInTx(tx: Transaction) {
  const now = new Date();
  // Only reconcile due memberships, in bounded batches; do not scan healthy games on every poll.
  const due = await tx
    .selectDistinct({ sessionId: gameMembers.sessionId })
    .from(gameMembers)
    .where(
      and(
        eq(gameMembers.active, true),
        or(
          lte(gameMembers.reservedUntil, now),
          and(
            lte(gameMembers.leaseUntil, now),
            ne(gameMembers.status, "reconnecting"),
          ),
        ),
      ),
    )
    .limit(100);
  const sessions = due.length
    ? await tx
        .select()
        .from(gameSessions)
        .where(
          and(
            ne(gameSessions.status, "ended"),
            inArray(
              gameSessions.id,
              due.map((r) => r.sessionId),
            ),
          ),
        )
    : [];
  for (const session of sessions) {
    const host = await activeGameCredential(
      tx,
      session.hostUserId,
      session.hostCredentialId,
    );
    const members = await tx
      .select()
      .from(gameMembers)
      .where(
        and(
          eq(gameMembers.sessionId, session.id),
          eq(gameMembers.active, true),
        ),
      );
    const owner = members.find(
      (m) =>
        m.role === "host" &&
        m.userId === session.hostUserId &&
        m.credentialId === session.hostCredentialId,
    );
    if (!host?.gameHostEnabled || !owner || owner.reservedUntil <= now) {
      await endGameInTx(tx, session.id, "host_unavailable");
      continue;
    }
    if (owner.leaseUntil <= now) {
      await tx
        .update(gameSessions)
        .set({ status: "recovering" })
        .where(eq(gameSessions.id, session.id));
      await tx
        .update(gameMembers)
        .set({ status: "reconnecting", route: null })
        .where(eq(gameMembers.id, owner.id));
    }
    for (const member of members) {
      if (member.role === "host") continue;
      if (
        member.reservedUntil <= now ||
        !(await activeGameCredential(tx, member.userId, member.credentialId))
      ) {
        await tx
          .update(gameMembers)
          .set({
            active: false,
            status: "removed",
            route: null,
            tunnelSecretHash: null,
            revision: sql`${gameMembers.revision}+1`,
          })
          .where(eq(gameMembers.id, member.id));
      } else if (member.leaseUntil <= now && member.status !== "reconnecting")
        await tx
          .update(gameMembers)
          .set({ status: "reconnecting", route: null })
          .where(eq(gameMembers.id, member.id));
    }
  }
  await tx
    .update(gameJoinRequests)
    .set({ status: "expired" })
    .where(
      and(
        eq(gameJoinRequests.status, "pending"),
        sql`${gameJoinRequests.expiresAt}<=${now}`,
      ),
    );
}
export async function gameTransaction<T>(
  action: (tx: Transaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${gameMutationLock})`);
    await reconcileGamesInTx(tx);
    return action(tx);
  });
}
export async function requireGameMember(
  tx: Transaction,
  user: User,
  id: string,
  hostOnly = false,
) {
  const account = await requireGameAccount(tx, user);
  const [session] = await tx
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.id, uuid(id)));
  if (!session || session.status === "ended")
    fail(404, "GAME_ENDED", "此联机已结束");
  const [member] = await tx
    .select()
    .from(gameMembers)
    .where(
      and(
        eq(gameMembers.sessionId, session.id),
        eq(gameMembers.userId, user.id),
        eq(gameMembers.active, true),
      ),
    );
  if (
    !member ||
    member.credentialId !== account.credentialId ||
    (hostOnly && member.role !== "host")
  )
    fail(403, "GAME_MEMBERSHIP_REQUIRED", "当前设备没有此联机的操作资格");
  return { session, member, account };
}
export async function clearCredentialGames(
  userId: string,
  credentialId?: string,
) {
  await gameTransaction(async (tx) => {
    await tx
      .update(gameJoinRequests)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(gameJoinRequests.userId, userId),
          eq(gameJoinRequests.status, "pending"),
          credentialId
            ? eq(gameJoinRequests.credentialId, credentialId)
            : undefined,
        ),
      );
    const affected = await tx
      .select()
      .from(gameMembers)
      .where(
        and(
          eq(gameMembers.userId, userId),
          eq(gameMembers.active, true),
          credentialId ? eq(gameMembers.credentialId, credentialId) : undefined,
        ),
      );
    for (const member of affected) {
      if (member.role === "host")
        await endGameInTx(tx, member.sessionId, "credential_revoked");
      else
        await tx
          .update(gameMembers)
          .set({
            active: false,
            status: "removed",
            route: null,
            tunnelSecretHash: null,
            revision: sql`${gameMembers.revision}+1`,
          })
          .where(eq(gameMembers.id, member.id));
    }
  });
}
export async function reconcileGameHost(userId: string) {
  await gameTransaction(async (tx) => {
    const [account] = await tx.select().from(users).where(eq(users.id, userId));
    if (account?.gameHostEnabled) return;
    const sessions = await tx
      .select()
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.hostUserId, userId),
          ne(gameSessions.status, "ended"),
        ),
      );
    for (const session of sessions)
      await endGameInTx(tx, session.id, "host_capability_revoked");
  });
}
export const gameReservationUntil = () =>
  new Date(Date.now() + GAME_RESERVATION_MS);
