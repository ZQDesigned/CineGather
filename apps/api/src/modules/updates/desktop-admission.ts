import type { Request } from "express";
import type { User, FeatureId } from "@cinegather/contracts";
import {
  rooms,
  roomSessions,
  members,
  gameSessions,
  gameMembers,
  gameInvites,
} from "@cinegather/database";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../../core/context";
import { fail } from "../../core/errors";
import {
  DesktopUpdateStore,
  desktopEntryFeatures,
  desktopEntryRequired,
} from "./desktop-updates";
import { bindDesktopCompatibility } from "./desktop-feature-context";
export async function desktopAdmission(
  req: Request,
  user: User,
  credentialId: string,
  store: DesktopUpdateStore,
) {
  // Read lazily: renewing/ending existing business must not depend on a new policy file.
  const platform = req.get("X-CineGather-Platform"),
    runtime = req.get("X-CineGather-Runtime");
  const read = () => {
    try {
      return (
        store.policy(platform, "x64", runtime)?.policy ??
        store.policy(platform, "arm64", runtime)?.policy
      );
    } catch {
      fail(503, "UPDATE_POLICY_UNAVAILABLE", "更新策略暂不可用，请稍后重试。");
    }
  };
  const revision = req.get("X-CineGather-Revision");
  bindDesktopCompatibility(user, revision, read);
  let features = desktopEntryFeatures(req.method, req.path, req.body),
    existing = false;
  if (!features) return;
  const policy = read();
  if (!policy) return;
  const join = /^\/api\/v1\/rooms\/([^/]+)\/(?:join|join-admission)$/.exec(
    req.path,
  );
  if (join) {
    const id = join[1]!,
      [room] = await db
        .select()
        .from(rooms)
        .where(
          /^[A-F0-9]{8}$/i.test(id)
            ? eq(rooms.code, id.toUpperCase())
            : /^[a-f0-9-]{36}$/i.test(id)
              ? eq(rooms.id, id)
              : eq(rooms.code, "invalid"),
        );
    if (!room) return;
    features = [
      room.mode === "esports" ? "room.esports" : "room.standard",
      ...(room.maxMembers > 10 ? ["room.large" as const] : []),
    ];
    const [session] = await db
      .select({ id: roomSessions.userId })
      .from(roomSessions)
      .innerJoin(
        members,
        and(
          eq(members.roomId, roomSessions.roomId),
          eq(members.userId, roomSessions.userId),
        ),
      )
      .where(
        and(
          eq(roomSessions.roomId, room.id),
          eq(roomSessions.credentialId, credentialId),
          eq(roomSessions.userId, user.id),
          gt(roomSessions.admittedUntil, new Date()),
          lt(members.joinedAt, new Date(policy.publishedAt)),
        ),
      );
    existing = !!session;
  }
  const game = /^\/api\/v1\/games\/([^/]+)\/(requests|transport)$/.exec(
    req.path,
  );
  const invite = /^\/api\/v1\/games\/invitations\/([^/]+)\/accept$/.exec(
    req.path,
  );
  if (game || invite) {
    let id = game?.[1];
    if (invite && /^[a-f0-9-]{36}$/i.test(invite[1]!)) {
      const [row] = await db
        .select()
        .from(gameInvites)
        .where(
          and(
            eq(gameInvites.id, invite[1]!),
            eq(gameInvites.recipientId, user.id),
          ),
        );
      id = row?.sessionId;
    }
    if (id && /^[a-f0-9-]{36}$/i.test(id)) {
      const [session] = await db
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.id, id));
      if (session) features = [`game.${session.game}` as FeatureId];
      const [member] = await db
        .select({ id: gameMembers.id })
        .from(gameMembers)
        .where(
          and(
            eq(gameMembers.sessionId, id),
            eq(gameMembers.credentialId, credentialId),
            eq(gameMembers.userId, user.id),
            eq(gameMembers.active, true),
            gt(gameMembers.reservedUntil, new Date()),
            lt(gameMembers.createdAt, new Date(policy.publishedAt)),
          ),
        );
      existing = !!member;
    }
  }
  const minimum = desktopEntryRequired(policy, revision, features, existing);
  if (minimum !== undefined)
    fail(
      426,
      "DESKTOP_UI_UPDATE_REQUIRED",
      "此功能需要更新资源，请在当前业务结束后应用更新。",
    );
}
