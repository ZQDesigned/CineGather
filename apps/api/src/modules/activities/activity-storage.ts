import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql, inArray } from "drizzle-orm";
import {
  rooms,
  members,
  roomSessions,
  credentials,
  users,
  bans,
  roomActivities,
  activityPermissions,
  whiteboardSnapshots,
  whiteboardRecords,
  type Transaction,
} from "@cinegather/database";
import type {
  User,
  ActivityRequest,
  WhiteboardDocument,
} from "@cinegather/contracts";
import { emptyWhiteboard } from "@cinegather/client-core";
import type { PartyGame } from "../party/party-game";
import { sessionCredential } from "../accounts/session-context";
import { fail } from "../../core/errors";

export interface ActivityData {
  id: string;
  generation: number;
  kind: "idle" | "board" | "game" | "screen";
  starterId?: string;
  title: string;
  board: WhiteboardDocument;
  game?: PartyGame;
  partyRecentAnswers?: Partial<Record<"draw" | "quiz", string[]>>;
  participants: Record<string, string>;
  editors?: Record<string, string>;
  requests: (ActivityRequest & { credentialId: string })[];
  seenLeaseId?: string;
  screenGrant?: {
    userId: string;
    credentialId: string;
    expiresAt: number;
    generation: number;
  };
}
export type ActivityRoom = typeof rooms.$inferSelect;
export function newActivity(title: string): ActivityData {
  return {
    id: randomUUID(),
    generation: 0,
    kind: "idle",
    title,
    board: emptyWhiteboard(),
    participants: {},
    editors: {},
    requests: [],
  };
}
export async function roomActivityAccess(
  tx: Transaction,
  user: User,
  roomId: string,
) {
  const [room] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .for("update");
  if (!room || room.status !== "active")
    fail(404, "ROOM_NOT_FOUND", "房间已关闭");
  if (room.mode !== "standard")
    fail(403, "ACTIVITY_STANDARD_ONLY", "此功能仅在普通房间提供");
  const credentialId = sessionCredential(user);
  const live = await admittedActivityMembers(tx, roomId);
  if (
    !credentialId ||
    !live.some((m) => m.userId === user.id && m.credentialId === credentialId)
  )
    fail(403, "ACTIVITY_NOT_ADMITTED", "请先加入房间");
  const [ban] = await tx
    .select()
    .from(bans)
    .where(and(eq(bans.roomId, roomId), eq(bans.userId, user.id)));
  if (ban) fail(403, "ROOM_BANNED", "你已被移出房间");
  return { room, live, credentialId };
}
export async function admittedActivityMembers(tx: Transaction, roomId: string) {
  return tx
    .select({
      userId: roomSessions.userId,
      credentialId: roomSessions.credentialId,
      name: users.displayName,
    })
    .from(roomSessions)
    .innerJoin(credentials, eq(credentials.id, roomSessions.credentialId))
    .innerJoin(users, eq(users.id, roomSessions.userId))
    .innerJoin(
      members,
      and(
        eq(members.roomId, roomSessions.roomId),
        eq(members.userId, roomSessions.userId),
      ),
    )
    .where(
      and(
        eq(roomSessions.roomId, roomId),
        gt(roomSessions.admittedUntil, new Date()),
        gt(members.admittedUntil, new Date()),
        gt(credentials.expiresAt, new Date()),
        isNull(credentials.revokedAt),
        isNull(users.disabledAt),
      ),
    );
}
export async function readActivity(tx: Transaction, room: ActivityRoom) {
  await tx
    .insert(roomActivities)
    .values({ roomId: room.id, state: newActivity(room.name) })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(roomActivities)
    .where(eq(roomActivities.roomId, room.id));
  return { state: row!.state as ActivityData, revision: row!.revision };
}
export async function writeActivity(
  tx: Transaction,
  roomId: string,
  state: ActivityData,
) {
  const [row] = await tx
    .update(roomActivities)
    .set({ state, revision: sql`${roomActivities.revision} + 1` })
    .where(eq(roomActivities.roomId, roomId))
    .returning();
  return row!.revision;
}
export async function saveBoard(
  tx: Transaction,
  state: ActivityData,
  recipients: string[],
) {
  if (state.kind !== "board" || !recipients.length) return;
  await lockWhiteboardArchives(tx);
  const document = {
    ...emptyWhiteboard(),
    revision: state.board.revision,
    elements: state.board.elements,
  };
  await tx
    .insert(whiteboardSnapshots)
    .values({
      id: randomUUID(),
      activityId: state.id,
      revision: state.board.revision,
      title: state.title,
      document,
    })
    .onConflictDoNothing();
  const [saved] = await tx
    .select({ id: whiteboardSnapshots.id })
    .from(whiteboardSnapshots)
    .where(
      and(
        eq(whiteboardSnapshots.activityId, state.id),
        eq(whiteboardSnapshots.revision, state.board.revision),
      ),
    );
  await tx
    .insert(whiteboardRecords)
    .values(
      [...new Set(recipients)].map((userId) => ({
        userId,
        snapshotId: saved!.id,
      })),
    )
    .onConflictDoNothing();
}
export async function archiveDeparting(
  tx: Transaction,
  roomId: string,
  userId: string,
) {
  const [row] = await tx
    .select()
    .from(roomActivities)
    .where(eq(roomActivities.roomId, roomId));
  if (!row) return;
  const state = row.state as ActivityData;
  if (state.participants[userId]) {
    await saveBoard(tx, state, [userId]);
    delete state.participants[userId];
  }
  if (state.editors) delete state.editors[userId];
  state.requests = state.requests.filter((r) => r.userId !== userId);
  if (state.screenGrant?.userId === userId) delete state.screenGrant;
  if (state.game) {
    const player = state.game.players.find((p) => p.id === userId);
    if (player) player.ready = false;
    if (
      state.game.drawerId === userId &&
      ["choosing", "playing", "paused"].includes(state.game.phase)
    ) {
      state.game.phase = "results";
      state.game.deadline = Date.now() + 1000;
    }
  }
  await writeActivity(tx, roomId, state);
}
export async function closeRoomActivities(tx: Transaction, roomId: string) {
  const [row] = await tx
    .select()
    .from(roomActivities)
    .where(eq(roomActivities.roomId, roomId));
  if (!row) return;
  const state = row.state as ActivityData;
  await saveBoard(tx, state, Object.keys(state.participants));
  state.kind = "idle";
  state.generation++;
  state.requests = [];
  state.participants = {};
  state.board = emptyWhiteboard();
  delete state.game;
  delete state.screenGrant;
  await writeActivity(tx, roomId, state);
}
export async function activityPolicies(tx: Transaction, roomId: string) {
  return tx
    .select({
      userId: activityPermissions.userId,
      board: activityPermissions.board,
      game: activityPermissions.game,
    })
    .from(activityPermissions)
    .where(eq(activityPermissions.roomId, roomId));
}
export async function requireActivityCapacity(
  tx: Transaction,
  userIds: string[],
) {
  if (!userIds.length) return;
  const full = await tx
    .select({ userId: whiteboardRecords.userId })
    .from(whiteboardRecords)
    .where(inArray(whiteboardRecords.userId, userIds))
    .groupBy(whiteboardRecords.userId)
    .having(sql`count(*) >= 100`);
  if (full.length)
    fail(
      409,
      "WHITEBOARD_HISTORY_FULL",
      "有成员的白板记录已满，请先整理记录后重试",
    );
}

export async function lockWhiteboardArchives(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(74921006)`);
}

export function canEditActivityBoard(
  state: ActivityData,
  userId: string,
  credentialId?: string,
) {
  if (state.kind === "board")
    return (
      state.starterId === userId ||
      (!!credentialId && state.editors?.[userId] === credentialId)
    );
  return (
    state.kind === "game" &&
    state.game?.kind === "draw" &&
    state.game.phase === "playing" &&
    state.game.drawerId === userId
  );
}
