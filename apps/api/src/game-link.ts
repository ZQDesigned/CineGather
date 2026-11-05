import { HttpException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, desc, sql } from "drizzle-orm";
import {
  gameSessions,
  gameMembers,
  gameJoinRequests,
  gameInvites,
  users,
  credentials,
  type Transaction,
} from "@cinegather/database";
import {
  GAME_MAX_MEMBERS,
  GAME_LEASE_MS,
  GAME_REQUEST_MS,
  GAME_INVITE_MS,
  gameSnapshotSchema,
  type GameSnapshot,
  type User,
  type GameKind,
} from "@cinegather/contracts";
import { audit } from "./context";
import { presenceLifetimeMs } from "./presence";
import { fail, uuid } from "./errors";
import { areAcceptedFriends } from "./friend-access";
import { sessionCredential } from "./session-context";
import {
  activeGameCredential,
  endGameInTx,
  gameReservationUntil,
  gameTransaction,
  requireGameAccount,
  requireGameDesktop,
  requireGamePlatform,
  requireGameMember,
} from "./game-link-access";

function supportsGame(user: User, game: GameKind) {
  try {
    requireGameDesktop(user, game);
    return true;
  } catch (error) {
    const body = error instanceof HttpException ? error.getResponse() : null;
    if (
      body &&
      typeof body === "object" &&
      "code" in body &&
      body.code === "FEATURE_UPDATE_REQUIRED"
    )
      return false;
    throw error;
  }
}

async function snapshotInTx(
  tx: Transaction,
  user: User,
): Promise<GameSnapshot> {
  const [active] = await tx
    .select()
    .from(gameMembers)
    .where(and(eq(gameMembers.userId, user.id), eq(gameMembers.active, true)));
  let [session] = active
    ? await tx
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.id, active.sessionId))
    : [];
  if (session && !supportsGame(user, session.game)) session = undefined;
  const invitations = await tx
    .select({
      id: gameInvites.id,
      sessionId: gameInvites.sessionId,
      sessionName: gameSessions.name,
      game: gameSessions.game,
      hostName: users.displayName,
      expiresAt: gameInvites.expiresAt,
    })
    .from(gameInvites)
    .innerJoin(gameSessions, eq(gameInvites.sessionId, gameSessions.id))
    .innerJoin(users, eq(gameSessions.hostUserId, users.id))
    .where(
      and(
        eq(gameInvites.recipientId, user.id),
        isNull(gameInvites.consumedAt),
        isNull(gameInvites.revokedAt),
        gt(gameInvites.expiresAt, new Date()),
        eq(gameSessions.status, "open"),
      ),
    )
    .orderBy(desc(gameInvites.createdAt))
    .limit(100);
  const requests = await tx
    .select({
      id: gameJoinRequests.id,
      sessionId: gameJoinRequests.sessionId,
      sessionName: gameSessions.name,
      game: gameSessions.game,
      userId: gameJoinRequests.userId,
      displayName: users.displayName,
      status: gameJoinRequests.status,
      expiresAt: gameJoinRequests.expiresAt,
    })
    .from(gameJoinRequests)
    .innerJoin(gameSessions, eq(gameJoinRequests.sessionId, gameSessions.id))
    .innerJoin(users, eq(gameJoinRequests.userId, users.id))
    .where(
      and(
        eq(gameJoinRequests.status, "pending"),
        active?.role === "host" && session
          ? eq(gameJoinRequests.sessionId, session.id)
          : and(
              eq(gameJoinRequests.userId, user.id),
              eq(gameJoinRequests.credentialId, sessionCredential(user)!),
            ),
      ),
    )
    .orderBy(desc(gameJoinRequests.createdAt))
    .limit(100);
  const members = session
    ? await tx
        .select({
          id: gameMembers.id,
          userId: gameMembers.userId,
          displayName: users.displayName,
          role: gameMembers.role,
          status: gameMembers.status,
          route: gameMembers.route,
        })
        .from(gameMembers)
        .innerJoin(users, eq(gameMembers.userId, users.id))
        .where(
          and(
            eq(gameMembers.sessionId, session.id),
            eq(gameMembers.active, true),
          ),
        )
    : [];
  const [host] = session
    ? await tx
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, session.hostUserId))
    : [];
  return gameSnapshotSchema.parse({
    session: session
      ? {
          id: session.id,
          code: session.code,
          name: session.name,
          game: session.game,
          hostUserId: session.hostUserId,
          hostName: host?.name ?? "",
          status: session.status,
          maxMembers: GAME_MAX_MEMBERS,
          memberCount: members.length,
          gameVersion: session.gameVersion,
          createdAt: session.createdAt.toISOString(),
        }
      : null,
    self:
      session && active && active.credentialId === sessionCredential(user)
        ? {
            memberId: active.id,
            revision: active.revision,
            role: active.role,
            leaseExpiresAt: active.leaseUntil.toISOString(),
          }
        : null,
    members,
    requests: requests
      .filter((r) => supportsGame(user, r.game))
      .map(({ game, ...r }) => ({
        ...r,
        ...(game === "stardew-valley" ? { game } : {}),
        expiresAt: r.expiresAt.toISOString(),
      })),
    invitations: invitations
      .filter((r) => supportsGame(user, r.game))
      .map(({ game, ...r }) => ({
        ...r,
        ...(game === "stardew-valley" ? { game } : {}),
        expiresAt: r.expiresAt.toISOString(),
      })),
  });
}
export const gameSnapshot = (user: User, cleanup = false) => {
  if (!cleanup) requireGamePlatform(user);
  // Unsupported sessions and invitations are filtered in snapshotInTx. Polling
  // is quiet; only an explicit operation asks for a feature-specific update.
  return gameTransaction(async (tx) => {
    await requireGameAccount(tx, user);
    return snapshotInTx(tx, user);
  });
};

export async function createGameSession(
  user: User,
  input: { game: GameKind; name: string; gameVersion?: string },
) {
  requireGameDesktop(user, input.game);
  await gameTransaction(async (tx) => {
    const actor = await requireGameAccount(tx, user);
    if (!actor.gameHostEnabled)
      fail(403, "GAME_HOST_DISABLED", "当前账号尚未开通发起游戏联机能力");
    const [current] = await tx
      .select()
      .from(gameMembers)
      .where(
        and(eq(gameMembers.userId, user.id), eq(gameMembers.active, true)),
      );
    if (current) {
      const [existing] = await tx
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.id, current.sessionId));
      if (
        current.role === "host" &&
        current.credentialId === actor.credentialId &&
        existing?.name === input.name &&
        existing.game === input.game
      )
        return;
      fail(409, "GAME_ALREADY_ACTIVE", "请先退出当前游戏联机");
    }
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
      id = randomUUID();
    let created = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = [...randomBytes(8)]
        .map((b) => alphabet[b % alphabet.length])
        .join("");
      const rows = await tx
        .insert(gameSessions)
        .values({
          id,
          code,
          name: input.name,
          game: input.game,
          gameVersion: input.gameVersion,
          hostUserId: user.id,
          hostCredentialId: actor.credentialId,
        })
        .onConflictDoNothing()
        .returning();
      if (rows.length) {
        created = true;
        break;
      }
    }
    if (!created)
      fail(503, "GAME_CODE_UNAVAILABLE", "暂时无法创建联机，请稍后重试");
    await tx.insert(gameMembers).values({
      id: randomUUID(),
      sessionId: id,
      userId: user.id,
      credentialId: actor.credentialId,
      role: "host",
      leaseUntil: new Date(Date.now() + GAME_LEASE_MS),
      reservedUntil: gameReservationUntil(),
    });
    await audit(tx, user.id, "game.created", id);
  });
  return gameSnapshot(user);
}
export async function setGameReady(user: User, id: string) {
  requireGameDesktop(user);
  await gameTransaction(async (tx) => {
    const { session, member } = await requireGameMember(tx, user, id, true);
    if (member.leaseUntil.getTime() <= Date.now())
      fail(409, "GAME_AUTH_EXPIRED", "联机授权已过期，请重新连接");
    await tx
      .update(gameSessions)
      .set({ status: "open" })
      .where(eq(gameSessions.id, session.id));
    await tx
      .update(gameMembers)
      .set({ status: "connected" })
      .where(eq(gameMembers.id, member.id));
  });
  return gameSnapshot(user);
}
export async function lookupGameSession(user: User, code: string) {
  requireGameDesktop(user);
  return gameTransaction(async (tx) => {
    await requireGameAccount(tx, user);
    const [session] = await tx
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.code, code), eq(gameSessions.status, "open")));
    if (!session)
      fail(404, "GAME_NOT_FOUND", "未找到可加入的游戏联机，请检查联机码");
    requireGameDesktop(user, session.game);
    const [host] = await tx
      .select()
      .from(users)
      .where(eq(users.id, session.hostUserId));
    const members = await tx
      .select({ id: gameMembers.id })
      .from(gameMembers)
      .where(
        and(
          eq(gameMembers.sessionId, session.id),
          eq(gameMembers.active, true),
        ),
      );
    return {
      id: session.id,
      name: session.name,
      ...(session.game === "stardew-valley" ? { game: session.game } : {}),
      hostName: host!.displayName,
      maxMembers: GAME_MAX_MEMBERS as 8,
      memberCount: members.length,
      gameVersion: session.gameVersion,
    };
  });
}
async function joinable(tx: Transaction, id: string) {
  const [session] = await tx
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.id, uuid(id)));
  if (!session || session.status === "ended")
    fail(404, "GAME_ENDED", "此联机已结束");
  if (session.status !== "open")
    fail(409, "GAME_NOT_READY", "主机暂时无法连接，请稍后重试");
  return session;
}
export async function requestGameJoin(user: User, id: string) {
  requireGameDesktop(user);
  return gameTransaction((tx) => requestGameInTx(tx, user, id));
}
async function requestGameInTx(tx: Transaction, user: User, id: string) {
  const actor = await requireGameAccount(tx, user),
    session = await joinable(tx, id);
  requireGameDesktop(user, session.game);
  const [active] = await tx
    .select()
    .from(gameMembers)
    .where(and(eq(gameMembers.userId, user.id), eq(gameMembers.active, true)));
  if (active) fail(409, "GAME_ALREADY_ACTIVE", "请先退出当前游戏联机");
  const members = await tx
    .select()
    .from(gameMembers)
    .where(
      and(eq(gameMembers.sessionId, session.id), eq(gameMembers.active, true)),
    );
  if (members.length >= GAME_MAX_MEMBERS)
    fail(409, "GAME_FULL", "游戏联机人数已满，无法申请加入");
  const [existing] = await tx
    .select()
    .from(gameJoinRequests)
    .where(
      and(
        eq(gameJoinRequests.sessionId, session.id),
        eq(gameJoinRequests.userId, user.id),
        eq(gameJoinRequests.status, "pending"),
      ),
    );
  if (existing) {
    if (existing.credentialId !== actor.credentialId)
      fail(
        409,
        "GAME_REQUEST_OTHER_DEVICE",
        "此账号已在另一台设备提交申请，请先在原设备取消后重试",
      );
    return { id: existing.id, expiresAt: existing.expiresAt.toISOString() };
  }
  const pending = await tx
    .select({ id: gameJoinRequests.id })
    .from(gameJoinRequests)
    .where(
      and(
        eq(gameJoinRequests.sessionId, session.id),
        eq(gameJoinRequests.status, "pending"),
      ),
    )
    .limit(100);
  if (pending.length >= 100)
    fail(429, "GAME_REQUESTS_BUSY", "当前申请较多，请稍后再试");
  const recent = await tx
    .select({ id: gameJoinRequests.id })
    .from(gameJoinRequests)
    .where(
      and(
        eq(gameJoinRequests.userId, user.id),
        gt(gameJoinRequests.createdAt, new Date(Date.now() - 60000)),
      ),
    )
    .limit(20);
  if (recent.length >= 20)
    fail(429, "GAME_REQUEST_LIMIT", "申请过于频繁，请稍后再试");
  const request = {
    id: randomUUID(),
    sessionId: session.id,
    userId: user.id,
    credentialId: actor.credentialId,
    expiresAt: new Date(Date.now() + GAME_REQUEST_MS),
  };
  await tx.insert(gameJoinRequests).values(request);
  await audit(tx, user.id, "game.join_requested", session.id);
  return { id: request.id, expiresAt: request.expiresAt.toISOString() };
}
export async function requestFriendGame(user: User, targetId: string) {
  targetId = uuid(targetId);
  requireGameDesktop(user);
  return gameTransaction(async (tx) => {
    await requireGameAccount(tx, user);
    if (!(await areAcceptedFriends(tx, user.id, targetId)))
      fail(404, "FRIEND_NOT_IN_GAME", "好友当前没有可加入的游戏联机");
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, targetId),
          eq(users.presenceVisibility, "online"),
          isNull(users.disabledAt),
        ),
      )
      .for("share");
    const [present] = target
      ? await tx
          .select({ id: credentials.id })
          .from(credentials)
          .where(
            and(
              eq(credentials.userId, targetId),
              eq(credentials.kind, "account"),
              isNull(credentials.revokedAt),
              gt(credentials.expiresAt, new Date()),
              gt(
                credentials.presenceAt,
                new Date(Date.now() - presenceLifetimeMs),
              ),
            ),
          )
          .limit(1)
      : [];
    const [location] = present
      ? await tx
          .select({ sessionId: gameMembers.sessionId })
          .from(gameMembers)
          .innerJoin(gameSessions, eq(gameMembers.sessionId, gameSessions.id))
          .where(
            and(
              eq(gameMembers.userId, targetId),
              eq(gameMembers.active, true),
              gt(gameMembers.reservedUntil, new Date()),
              eq(gameSessions.status, "open"),
            ),
          )
          .limit(1)
      : [];
    if (!location)
      fail(404, "FRIEND_NOT_IN_GAME", "好友当前没有可加入的游戏联机");
    return requestGameInTx(tx, user, location.sessionId);
  });
}

async function admit(
  tx: Transaction,
  sessionId: string,
  userId: string,
  credentialId: string,
  method: "request" | "invitation" = "request",
) {
  if (!(await activeGameCredential(tx, userId, credentialId)))
    fail(409, "GAME_APPLICANT_OFFLINE", "申请设备已退出登录，请对方重新申请");
  const [active] = await tx
    .select()
    .from(gameMembers)
    .where(and(eq(gameMembers.userId, userId), eq(gameMembers.active, true)));
  if (active) {
    if (active.sessionId === sessionId && active.credentialId === credentialId)
      return;
    fail(409, "GAME_ALREADY_ACTIVE", "对方已在其他游戏联机或设备中，请先退出");
  }
  const occupied = await tx
    .select({ id: gameMembers.id })
    .from(gameMembers)
    .where(
      and(eq(gameMembers.sessionId, sessionId), eq(gameMembers.active, true)),
    );
  if (occupied.length >= GAME_MAX_MEMBERS)
    fail(409, "GAME_FULL", "游戏联机人数已满，无法加入");
  const now = new Date(Date.now() + GAME_LEASE_MS),
    reserved = gameReservationUntil();
  await tx
    .insert(gameMembers)
    .values({
      id: randomUUID(),
      sessionId,
      userId,
      credentialId,
      role: "guest",
      leaseUntil: now,
      reservedUntil: reserved,
    })
    .onConflictDoUpdate({
      target: [gameMembers.sessionId, gameMembers.userId],
      set: {
        credentialId,
        role: "guest",
        status: "approved",
        active: true,
        leaseUntil: now,
        reservedUntil: reserved,
        revision: sql`${gameMembers.revision}+1`,
        route: null,
        tunnelSecretHash: null,
      },
    });
  await audit(tx, userId, "game.member_joined", sessionId, { userId, method });
}
export async function decideGameRequest(
  user: User,
  requestId: string,
  approve: boolean,
) {
  requireGameDesktop(user);
  await gameTransaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(gameJoinRequests)
      .where(eq(gameJoinRequests.id, uuid(requestId)));
    if (!request) fail(404, "GAME_REQUEST_NOT_FOUND", "未找到此联机申请");
    await requireGameMember(tx, user, request.sessionId, true);
    if (request.status === "approved" && approve) return;
    if (
      request.status !== "pending" ||
      request.expiresAt.getTime() <= Date.now()
    )
      fail(409, "GAME_REQUEST_EXPIRED", "此联机申请已处理或过期");
    if (approve) {
      await joinable(tx, request.sessionId);
      await admit(tx, request.sessionId, request.userId, request.credentialId);
    }
    await tx
      .update(gameJoinRequests)
      .set({ status: approve ? "approved" : "rejected" })
      .where(eq(gameJoinRequests.id, request.id));
    await audit(
      tx,
      user.id,
      approve ? "game.request_approved" : "game.request_rejected",
      request.sessionId,
      { userId: request.userId },
    );
  });
  return gameSnapshot(user);
}
export async function inviteGameFriend(
  user: User,
  id: string,
  recipientId: string,
) {
  requireGameDesktop(user);
  recipientId = uuid(recipientId);
  return gameTransaction(async (tx) => {
    const { session } = await requireGameMember(tx, user, id, true);
    await joinable(tx, id);
    if (!(await areAcceptedFriends(tx, user.id, recipientId)))
      fail(403, "GAME_FRIEND_REQUIRED", "只能邀请已添加的好友");
    const [existing] = await tx
      .select()
      .from(gameInvites)
      .where(
        and(
          eq(gameInvites.sessionId, session.id),
          eq(gameInvites.recipientId, recipientId),
          isNull(gameInvites.consumedAt),
          isNull(gameInvites.revokedAt),
          gt(gameInvites.expiresAt, new Date()),
        ),
      );
    if (existing)
      return { id: existing.id, expiresAt: existing.expiresAt.toISOString() };
    const recent = await tx
      .select({ id: gameInvites.id })
      .from(gameInvites)
      .where(
        and(
          eq(gameInvites.sessionId, session.id),
          gt(gameInvites.createdAt, new Date(Date.now() - 60000)),
        ),
      )
      .limit(30);
    if (recent.length >= 30)
      fail(429, "GAME_INVITE_LIMIT", "邀请过于频繁，请稍后再试");
    const invite = {
      id: randomUUID(),
      sessionId: session.id,
      recipientId,
      expiresAt: new Date(Date.now() + GAME_INVITE_MS),
    };
    await tx.insert(gameInvites).values(invite);
    await audit(tx, user.id, "game.invited", session.id, {
      userId: recipientId,
    });
    return { id: invite.id, expiresAt: invite.expiresAt.toISOString() };
  });
}
export async function acceptGameInvite(user: User, inviteId: string) {
  requireGameDesktop(user);
  await gameTransaction(async (tx) => {
    const account = await requireGameAccount(tx, user);
    const [invite] = await tx
      .select()
      .from(gameInvites)
      .where(
        and(
          eq(gameInvites.id, uuid(inviteId)),
          eq(gameInvites.recipientId, user.id),
        ),
      );
    if (!invite) fail(404, "GAME_INVITE_NOT_FOUND", "未找到属于你的联机邀请");
    if (invite.revokedAt || invite.expiresAt.getTime() <= Date.now())
      fail(409, "GAME_INVITE_EXPIRED", "此联机邀请已失效");
    const session = await joinable(tx, invite.sessionId);
    requireGameDesktop(user, session.game);
    if (!(await areAcceptedFriends(tx, session.hostUserId, user.id)))
      fail(403, "GAME_FRIEND_REQUIRED", "好友关系已变化，请通过联机码重新申请");
    if (invite.consumedAt) {
      const [active] = await tx
        .select()
        .from(gameMembers)
        .where(
          and(
            eq(gameMembers.sessionId, session.id),
            eq(gameMembers.userId, user.id),
            eq(gameMembers.credentialId, account.credentialId),
            eq(gameMembers.active, true),
          ),
        );
      if (active) return;
      fail(409, "GAME_INVITE_EXPIRED", "此邀请已使用，请重新申请加入");
    }
    await admit(tx, session.id, user.id, account.credentialId, "invitation");
    await tx
      .update(gameInvites)
      .set({ consumedAt: new Date() })
      .where(eq(gameInvites.id, invite.id));
    await audit(tx, user.id, "game.invite_accepted", session.id, {
      userId: user.id,
    });
  });
  return gameSnapshot(user);
}
export async function renewGameMembership(
  user: User,
  id: string,
  revision: number,
) {
  requireGameDesktop(user);
  await gameTransaction(async (tx) => {
    const { session, member } = await requireGameMember(tx, user, id);
    if (member.revision !== revision)
      fail(409, "GAME_AUTH_EXPIRED", "联机授权已变化，请重新加入");
    if (member.role !== "host" && session.status !== "open")
      fail(409, "GAME_NOT_READY", "主机正在恢复连接");
    await tx
      .update(gameMembers)
      .set({
        leaseUntil: new Date(Date.now() + GAME_LEASE_MS),
        reservedUntil: gameReservationUntil(),
        status: member.status === "reconnecting" ? "connecting" : member.status,
        revision:
          member.leaseUntil.getTime() <= Date.now()
            ? member.revision + 1
            : member.revision,
        tunnelSecretHash:
          member.leaseUntil.getTime() <= Date.now()
            ? null
            : member.tunnelSecretHash,
        route: member.leaseUntil.getTime() <= Date.now() ? null : member.route,
      })
      .where(eq(gameMembers.id, member.id));
    if (member.status === "reconnecting")
      await audit(tx, user.id, "game.member_reconnected", session.id, {
        userId: user.id,
      });
  });
  return gameSnapshot(user);
}
export async function leaveGameSession(user: User, id: string, end = false) {
  await gameTransaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, uuid(id)));
    if (!session || session.status === "ended") return;
    const { member } = await requireGameMember(tx, user, id, end, false);
    if (member.role === "host")
      await endGameInTx(tx, session.id, "host_ended", user.id);
    else {
      await tx
        .update(gameMembers)
        .set({
          active: false,
          status: "left",
          route: null,
          tunnelSecretHash: null,
          revision: sql`${gameMembers.revision}+1`,
        })
        .where(eq(gameMembers.id, member.id));
      await audit(tx, user.id, "game.member_left", session.id, {
        userId: user.id,
      });
    }
  });
  return gameSnapshot(user, true);
}
export async function removeGameMember(
  user: User,
  id: string,
  memberId: string,
) {
  requireGameDesktop(user);
  await gameTransaction(async (tx) => {
    await requireGameMember(tx, user, id, true);
    const [member] = await tx
      .select()
      .from(gameMembers)
      .where(
        and(
          eq(gameMembers.id, uuid(memberId)),
          eq(gameMembers.sessionId, uuid(id)),
        ),
      );
    if (!member || !member.active) return;
    if (member.role === "host")
      fail(400, "GAME_HOST_REQUIRED", "请使用结束联机关闭自己的会话");
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
    await audit(tx, user.id, "game.member_removed", id, {
      userId: member.userId,
    });
  });
  return { ok: true as const };
}

export async function cancelGameRequest(user: User, id: string) {
  await gameTransaction(async (tx) => {
    const actor = await requireGameAccount(tx, user);
    await tx
      .update(gameJoinRequests)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(gameJoinRequests.id, uuid(id)),
          eq(gameJoinRequests.userId, user.id),
          eq(gameJoinRequests.credentialId, actor.credentialId),
          eq(gameJoinRequests.status, "pending"),
        ),
      );
  });
  return { ok: true as const };
}
export async function dismissGameInvite(user: User, id: string) {
  await gameTransaction(async (tx) => {
    await requireGameAccount(tx, user);
    await tx
      .update(gameInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(gameInvites.id, uuid(id)), eq(gameInvites.recipientId, user.id)),
      );
  });
  return { ok: true as const };
}

export async function observeGameConnection(
  user: User,
  id: string,
  memberId: string,
  revision: number,
  route: "p2p" | "relay",
) {
  requireGameDesktop(user);
  await gameTransaction(async (tx) => {
    await requireGameMember(tx, user, id, true);
    await tx
      .update(gameMembers)
      .set({ route, status: "connected" })
      .where(
        and(
          eq(gameMembers.id, uuid(memberId)),
          eq(gameMembers.sessionId, id),
          eq(gameMembers.role, "guest"),
          eq(gameMembers.active, true),
          eq(gameMembers.revision, revision),
          gt(gameMembers.leaseUntil, new Date()),
        ),
      );
  });
  return { ok: true as const };
}
