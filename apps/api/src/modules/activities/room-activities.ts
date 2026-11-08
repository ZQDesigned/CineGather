import { listPartyCatalog, lockPartyBank } from "../party/party-categories";
import { activePartyWords } from "../party/party-bank";
import { sessionCredential } from "../accounts/session-context";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  roomActivities,
  activityPermissions,
  whiteboardRecords,
  whiteboardSnapshots,
  whiteboardImages,
  leases,
  rooms,
  type Transaction,
} from "@cinegather/database";
import type {
  User,
  ActivityCommand,
  ActivitySnapshot,
  ActivityTarget,
  WhiteboardDocument,
} from "@cinegather/contracts";
import { emptyWhiteboard, editWhiteboard } from "@cinegather/client-core";
import { db, audit } from "../../core/context";
import { fail, uuid } from "../../core/errors";
import { requireFeature } from "../updates/feature-policy";
import { media } from "../media/media";
import {
  newPartyGame,
  partyCommand,
  partyView,
  tickPartyGame,
} from "../party/party-game";
import {
  canEditActivityBoard,
  lockWhiteboardArchives,
  admittedActivityMembers,
  roomActivityAccess,
  readActivity,
  writeActivity,
  saveBoard,
  newActivity,
  activityPolicies,
  requireActivityCapacity,
  type ActivityData,
  type ActivityRoom,
} from "./activity-storage";
export { archiveDeparting, closeRoomActivities } from "./activity-storage";
export const activityEvents = new EventEmitter();
activityEvents.setMaxListeners(1000);

async function reconcile(
  tx: Transaction,
  room: ActivityRoom,
  state: ActivityData,
) {
  const now = Date.now(),
    live = await admittedActivityMembers(tx, room.id);
  for (const [userId, credential] of Object.entries(state.participants)) {
    if (
      !live.some((m) => m.userId === userId && m.credentialId === credential)
    ) {
      await saveBoard(tx, state, [userId]);
      delete state.participants[userId];
    }
  }
  state.editors ??= {};
  for (const [id, credential] of Object.entries(state.editors))
    if (!live.some((m) => m.userId === id && m.credentialId === credential))
      delete state.editors[id];
  const policies = await activityPolicies(tx, room.id);
  state.requests = state.requests.filter(
    (r) =>
      r.expiresAt > now &&
      r.generation === state.generation &&
      live.some(
        (m) => m.userId === r.userId && m.credentialId === r.credentialId,
      ) &&
      (r.target === "screen" ||
        policies.find((p) => p.userId === r.userId)?.[
          r.target === "board" ? "board" : "game"
        ] !== false),
  );
  if (
    state.screenGrant &&
    (state.screenGrant.expiresAt <= now ||
      !live.some(
        (m) =>
          m.userId === state.screenGrant!.userId &&
          m.credentialId === state.screenGrant!.credentialId,
      ))
  )
    delete state.screenGrant;
  if (state.starterId && !live.some((m) => m.userId === state.starterId))
    state.starterId = room.ownerUserId;
  if (state.game) {
    for (const p of state.game.players)
      if (!live.some((m) => m.userId === p.id)) p.ready = false;
    if (
      state.game.drawerId &&
      !state.game.players.some(
        (p) => p.id === state.game!.drawerId && p.ready,
      ) &&
      ["playing", "choosing", "paused"].includes(state.game.phase)
    ) {
      state.game.phase = "results";
      state.game.deadline = now + 1000;
    }
    const before = state.game.round;
    state.game = tickPartyGame(state.game, now);
    state.partyRecentAnswers = {
      ...state.partyRecentAnswers,
      [state.game.kind]: state.game.recentAnswers ?? [
        ...state.game.used,
        ...(state.game.choiceHistory ?? []),
      ],
    };
    if (before !== state.game.round) state.board = emptyWhiteboard();
  }
  const [lease] = await tx
    .select()
    .from(leases)
    .where(eq(leases.roomId, room.id));
  const active =
    lease?.leaseId &&
    lease.holderUserId &&
    lease.expiresAt &&
    lease.expiresAt.getTime() > now;
  if (active && ["idle", "screen"].includes(state.kind)) {
    if (state.seenLeaseId !== lease.leaseId) {
      state.generation++;
      state.requests = [];
    }
    state.kind = "screen";
    state.seenLeaseId = lease.leaseId!;
    state.starterId = lease.holderUserId!;
  } else if (!active && state.kind === "screen") {
    state.kind = "idle";
    state.generation++;
    state.requests = [];
    delete state.starterId;
    delete state.seenLeaseId;
  }
  return { live, policies };
}
function view(
  room: ActivityRoom,
  state: ActivityData,
  revision: number,
  user: User,
  permissions: ActivitySnapshot["permissions"],
): ActivitySnapshot {
  return {
    roomId: room.id,
    revision,
    generation: state.generation,
    kind: state.kind,
    ownerId: room.ownerUserId,
    starterId: state.starterId,
    title: state.title,
    ...(["board", "game"].includes(state.kind)
      ? {
          board: {
            elements: state.board.elements,
            revision: state.board.revision,
            canUndo: state.board.undo.some((e) => e.actor === user.id),
            canRedo: state.board.redo.some((e) => e.actor === user.id),
            canEdit: canEditActivityBoard(
              state,
              user.id,
              sessionCredential(user),
            ),
            editorIds:
              state.kind === "board"
                ? [
                    ...new Set([
                      state.starterId!,
                      ...Object.keys(state.editors ?? {}),
                    ]),
                  ].filter(Boolean)
                : state.game?.drawerId
                  ? [state.game.drawerId]
                  : [],
          },
        }
      : {}),
    ...(state.game ? { game: partyView(state.game, user.id, Date.now()) } : {}),
    requests: state.requests
      .filter(
        (r) =>
          r.userId === user.id ||
          user.id === room.ownerUserId ||
          user.id === state.starterId,
      )
      .map(({ credentialId: _credential, ...request }) => request),
    permissions,
  };
}
export async function activitySnapshot(
  user: User,
  roomId: string,
): Promise<ActivitySnapshot> {
  requireFeature(user, "room.activities");
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    const { room, credentialId } = await roomActivityAccess(tx, user, roomId);
    const { state, revision } = await readActivity(tx, room),
      before = JSON.stringify(state);
    const { policies } = await reconcile(tx, room, state);
    if (state.kind === "board" && !state.participants[user.id]) {
      await requireActivityCapacity(tx, [user.id]);
      state.participants[user.id] = credentialId;
    }
    const nextRevision =
      before === JSON.stringify(state)
        ? revision
        : await writeActivity(tx, roomId, state);
    return view(room, state, nextRevision, user, policies);
  });
}
async function canStart(
  tx: Transaction,
  room: ActivityRoom,
  user: User,
  target: ActivityTarget,
) {
  if (target === "screen") {
    const { requireScreenShare } = await import("../rooms/rooms");
    await requireScreenShare(tx, user.id, room.id);
    requireFeature(user, "screen.publish");
    return;
  }
  const policy = (await activityPolicies(tx, room.id)).find(
    (p) => p.userId === user.id,
  );
  if (
    user.id !== room.ownerUserId &&
    policy?.[target === "board" ? "board" : "game"] === false
  )
    fail(403, "ACTIVITY_START_FORBIDDEN", "房主暂未允许你发起此活动");
}
async function stopScreen(tx: Transaction, roomId: string) {
  const [lease] = await tx
    .select()
    .from(leases)
    .where(eq(leases.roomId, roomId));
  const { revokeNative } = await import("../rooms/rooms");
  await revokeNative(tx, roomId);
  for (const p of await media.participants(roomId))
    await media.setShare(roomId, p.rawIdentity ?? p.identity, false);
  await tx
    .update(leases)
    .set({
      holderUserId: null,
      credentialId: null,
      leaseId: null,
      expiresAt: null,
      revision: sql`${leases.revision}+1`,
    })
    .where(eq(leases.roomId, roomId));
  return lease?.holderUserId && lease.leaseId
    ? { userId: lease.holderUserId, leaseId: lease.leaseId }
    : undefined;
}
export async function activityCommand(
  user: User,
  roomId: string,
  command: ActivityCommand,
): Promise<ActivitySnapshot> {
  requireFeature(user, "room.activities");
  roomId = uuid(roomId);
  let stopped: { userId: string; leaseId: string } | undefined;
  const result = await db.transaction(async (tx) => {
    const { room, credentialId } = await roomActivityAccess(tx, user, roomId);
    let { state } = await readActivity(tx, room);
    const { live } = await reconcile(tx, room, state);
    if ("generation" in command && command.generation !== state.generation)
      fail(409, "ACTIVITY_CHANGED", "房间活动已变化，请重试");
    const controller =
      room.ownerUserId === user.id || state.starterId === user.id;
    const requireControl = () => {
      if (!controller)
        fail(403, "ACTIVITY_CONTROL_REQUIRED", "请向发起人或房主申请切换");
    };
    if (command.type === "permissions") {
      if (room.ownerUserId !== user.id)
        fail(403, "OWNER_REQUIRED", "仅房主可修改权限");
      if (
        !live.some((m) => m.userId === command.userId) ||
        command.userId === room.ownerUserId
      )
        fail(400, "INVALID_MEMBER", "请选择房间中的其他成员");
      const previous = (await activityPolicies(tx, roomId)).find(
        (p) => p.userId === command.userId,
      );
      const policy = {
        board: command.board ?? previous?.board ?? true,
        game: command.game ?? previous?.game ?? true,
      };
      await tx
        .insert(activityPermissions)
        .values({
          roomId,
          userId: command.userId,
          board: policy.board,
          game: policy.game,
        })
        .onConflictDoUpdate({
          target: [activityPermissions.roomId, activityPermissions.userId],
          set: { board: policy.board, game: policy.game },
        });
      state.requests = state.requests.filter(
        (r) =>
          r.userId !== command.userId ||
          r.target === "screen" ||
          (r.target === "board" ? policy.board : policy.game),
      );
      await audit(tx, user.id, "room.activity_permissions", roomId, {
        userId: command.userId,
        board: policy.board,
        game: policy.game,
      });
    } else if (command.type === "request") {
      await canStart(tx, room, user, command.target);
      if (state.kind === "idle")
        fail(409, "ACTIVITY_IDLE", "当前可以直接发起活动");
      if (state.requests.some((r) => r.userId === user.id))
        fail(409, "ACTIVITY_REQUEST_EXISTS", "已有待处理的申请");
      state.requests.push({
        id: randomUUID(),
        credentialId,
        userId: user.id,
        name: user.displayName,
        target: command.target,
        generation: state.generation,
        status: "pending",
        expiresAt: Date.now() + 120000,
      });
    } else if (command.type === "decide" || command.type === "cancel") {
      const request = state.requests.find((r) => r.id === command.requestId);
      if (!request) fail(409, "ACTIVITY_REQUEST_EXPIRED", "申请已失效");
      if (command.type === "cancel") {
        if (request.userId !== user.id) requireControl();
        state.requests = state.requests.filter((r) => r.id !== request.id);
      } else {
        requireControl();
        if (request.status !== "pending")
          fail(409, "ACTIVITY_REQUEST_DECIDED", "此申请已处理");
        if (command.approve) {
          request.status = "approved";
          request.expiresAt = Date.now() + 60000;
        } else
          state.requests = state.requests.filter((r) => r.id !== request.id);
      }
    } else if (command.type === "start") {
      await canStart(tx, room, user, command.target);
      const request = state.requests.find(
        (r) =>
          r.id === command.requestId &&
          r.userId === user.id &&
          r.target === command.target &&
          r.status === "approved",
      );
      if (state.kind !== "idle" && !controller && !request) requireControl();
      if (command.target === "screen") {
        // The existing source picker calls acquire only after user confirmation.
        state.screenGrant = {
          userId: user.id,
          credentialId,
          expiresAt: Date.now() + 60000,
          generation: state.generation,
        };
      } else {
        let board = emptyWhiteboard();
        if (command.historyId) {
          if (command.target !== "board")
            fail(400, "INVALID_INPUT", "仅白板可载入记录");
          board = await historyDocument(tx, user.id, command.historyId);
        }
        if (command.target === "board")
          await requireActivityCapacity(
            tx,
            live.map((m) => m.userId),
          );
        await saveBoard(tx, state, Object.keys(state.participants));
        if (state.kind === "screen") stopped = await stopScreen(tx, roomId);
        const generation = state.generation + 1;
        state = {
          ...newActivity(room.name),
          partyRecentAnswers: state.partyRecentAnswers,
          generation,
          kind: command.target === "board" ? "board" : "game",
          starterId: user.id,
          board,
          ...(command.target === "board"
            ? {
                participants: Object.fromEntries(
                  live.map((m) => [m.userId, m.credentialId]),
                ),
              }
            : {
                game: newPartyGame(
                  command.target,
                  await activePartyWords(tx, command.target, null, false, true),
                  state.partyRecentAnswers?.[command.target],
                ),
              }),
        };
        await audit(tx, user.id, "room.activity_started", roomId, {
          kind: command.target,
          generation,
        });
      }
    } else if (command.type === "end") {
      requireControl();
      await saveBoard(tx, state, Object.keys(state.participants));
      if (state.kind === "screen") stopped = await stopScreen(tx, roomId);
      state = {
        ...newActivity(room.name),
        partyRecentAnswers: state.partyRecentAnswers,
        generation: state.generation + 1,
      };
      await audit(tx, user.id, "room.activity_ended", roomId);
    } else if (command.type === "board-editor") {
      if (state.kind !== "board" || state.starterId !== user.id)
        fail(
          403,
          "WHITEBOARD_STARTER_REQUIRED",
          "仅白板发起人可以邀请或移除编辑成员",
        );
      const target = live.find((m) => m.userId === command.userId);
      if (!target || command.userId === state.starterId)
        fail(400, "INVALID_MEMBER", "请选择房间中的其他成员");
      state.editors ??= {};
      if (command.enabled) state.editors[command.userId] = target.credentialId;
      else delete state.editors[command.userId];
      await audit(tx, user.id, "room.whiteboard_editor", roomId, {
        userId: command.userId,
        enabled: command.enabled,
        generation: state.generation,
      });
    } else if (command.type === "board") {
      if (!canEditActivityBoard(state, user.id, credentialId))
        fail(
          403,
          "WHITEBOARD_NOT_EDITABLE",
          "当前仅可查看白板，请由发起人邀请编辑",
        );
      if (command.operation.type === "clear" && state.kind === "board")
        requireControl();
      if (
        command.operation.type === "put" &&
        command.operation.element.imageId &&
        state.board.elements.find(
          (e) =>
            command.operation.type === "put" &&
            e.id === command.operation.element.id,
        )?.imageId !== command.operation.element.imageId
      ) {
        if (state.kind !== "board" || state.starterId !== user.id)
          fail(403, "WHITEBOARD_UPLOAD_FORBIDDEN", "仅白板发起人可以加入图片");
        const [image] = await tx
          .select()
          .from(whiteboardImages)
          .where(eq(whiteboardImages.id, command.operation.element.imageId));
        if (!image || image.activityId !== state.id)
          fail(403, "WHITEBOARD_IMAGE_FORBIDDEN", "图片不属于当前白板");
      }
      try {
        state.board = editWhiteboard(state.board, command.operation, user.id);
      } catch (e) {
        fail(409, "WHITEBOARD_CONFLICT", (e as Error).message);
      }
      if (state.kind === "board") state.participants[user.id] = credentialId;
    } else if (command.type === "party") {
      if (state.kind !== "game" || !state.game)
        fail(409, "PARTY_NOT_ACTIVE", "当前没有聚会游戏");
      if (
        ["start", "pause", "resume", "categories"].includes(command.action.type)
      )
        requireControl();
      if (command.action.type === "categories") {
        if (!["lobby", "finished"].includes(state.game.phase))
          fail(
            409,
            "PARTY_ALREADY_STARTED",
            "本场已开始，请在下一场开始前选择分类",
          );
        const selection = state.game.categorySelection ?? {
          categoryIds: null,
          version: 0,
        };
        if (selection.version !== command.action.selectionVersion)
          fail(409, "PARTY_SELECTION_CHANGED", "分类选择已更新，请刷新后重试");
        const catalog = await listPartyCatalog(tx);
        if (
          command.action.categoryIds.some(
            (id) => !catalog.categories.some((c) => c.id === id),
          )
        )
          fail(409, "PARTY_CATEGORIES_CHANGED", "分类已移除，请重新选择");
        state.game.categorySelection = {
          categoryIds: command.action.categoryIds,
          version: selection.version + 1,
        };
      }
      if (command.action.type === "start") {
        if (!["lobby", "finished"].includes(state.game.phase))
          fail(409, "PARTY_ALREADY_STARTED", "本场已开始");
        await lockPartyBank(tx);
        state.game.wordPool = await activePartyWords(
          tx,
          state.game.kind,
          state.game.categorySelection?.categoryIds ?? null,
          true,
        );
      }
      try {
        if (command.action.type !== "categories")
          state.game = partyCommand(
            state.game,
            { id: user.id, name: user.displayName },
            command.action,
            Date.now(),
          );
      } catch (e) {
        fail(409, "PARTY_ACTION_UNAVAILABLE", (e as Error).message);
      }
      if (command.action.type === "start") state.board = emptyWhiteboard();
    }
    if (state.game)
      state.partyRecentAnswers = {
        ...state.partyRecentAnswers,
        [state.game.kind]: state.game.recentAnswers ?? [
          ...state.game.used,
          ...(state.game.choiceHistory ?? []),
        ],
      };
    const revision = await writeActivity(tx, roomId, state);
    return view(
      room,
      state,
      revision,
      user,
      await activityPolicies(tx, roomId),
    );
  });
  // Notify only after the transition commits, using the old lease ID so a
  // delayed notification cannot stop a replacement publisher.
  if (stopped)
    await media
      .control(stopped.userId, {
        action: "stop-share",
        roomId,
        leaseId: stopped.leaseId,
      })
      .catch(() => {});
  activityEvents.emit(roomId);
  return result;
}
export async function guardActivityShare(
  tx: Transaction,
  roomId: string,
  userId: string,
  credentialId?: string,
) {
  const [row] = await tx
    .select()
    .from(roomActivities)
    .where(eq(roomActivities.roomId, roomId));
  if (!row) return false;
  const state = row.state as ActivityData,
    grant = state.screenGrant;
  const authorized =
    !!grant &&
    grant.userId === userId &&
    grant.credentialId === credentialId &&
    grant.generation === state.generation &&
    grant.expiresAt > Date.now();
  if (["board", "game"].includes(state.kind) && !authorized)
    fail(
      409,
      "ROOM_ACTIVITY_BUSY",
      "房间正在进行其他活动，请先申请切换或结束活动",
    );
  if (authorized) {
    await saveBoard(tx, state, Object.keys(state.participants));
    state.kind = "idle";
    state.board = emptyWhiteboard();
    delete state.game;
    delete state.screenGrant;
    state.requests = [];
    state.participants = {};
    await writeActivity(tx, roomId, state);
  }
  return authorized;
}
export async function listWhiteboards(user: User) {
  const items = await db
    .select({
      id: whiteboardSnapshots.id,
      title: whiteboardSnapshots.title,
      createdAt: whiteboardSnapshots.createdAt,
      elementCount: sql<number>`jsonb_array_length(${whiteboardSnapshots.document}->'elements')`,
    })
    .from(whiteboardRecords)
    .innerJoin(
      whiteboardSnapshots,
      eq(whiteboardRecords.snapshotId, whiteboardSnapshots.id),
    )
    .where(eq(whiteboardRecords.userId, user.id))
    .orderBy(desc(whiteboardSnapshots.createdAt))
    .limit(101);
  return {
    items: items.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      elementCount: r.elementCount,
    })),
  };
}
async function historyDocument(tx: Transaction, userId: string, id: string) {
  await lockWhiteboardArchives(tx);
  const [record] = await tx
    .select({ document: whiteboardSnapshots.document })
    .from(whiteboardRecords)
    .innerJoin(
      whiteboardSnapshots,
      eq(whiteboardRecords.snapshotId, whiteboardSnapshots.id),
    )
    .where(
      and(
        eq(whiteboardRecords.userId, userId),
        eq(whiteboardRecords.snapshotId, uuid(id)),
      ),
    );
  if (!record) fail(404, "WHITEBOARD_NOT_FOUND", "白板记录不存在");
  return {
    ...emptyWhiteboard(),
    elements: (record.document as WhiteboardDocument).elements.map((e) => ({
      ...e,
      version: 1,
    })),
    revision: 1,
  };
}
export async function getWhiteboard(user: User, id: string) {
  return db.transaction((tx) => historyDocument(tx, user.id, id));
}
export async function deleteWhiteboard(user: User, id: string) {
  await db
    .delete(whiteboardRecords)
    .where(
      and(
        eq(whiteboardRecords.userId, user.id),
        eq(whiteboardRecords.snapshotId, uuid(id)),
      ),
    );
  return { ok: true as const };
}
export async function tickRoomActivities() {
  const active = await db
    .select({ roomId: roomActivities.roomId })
    .from(roomActivities)
    .innerJoin(rooms, eq(rooms.id, roomActivities.roomId))
    .where(
      and(
        eq(rooms.status, "active"),
        sql`${roomActivities.state}->>'kind' <> 'idle'`,
      ),
    );
  for (const { roomId } of active) {
    const changed = await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .for("update");
      if (!room || room.status !== "active") return false;
      const { state } = await readActivity(tx, room),
        before = JSON.stringify(state);
      await reconcile(tx, room, state);
      if (before === JSON.stringify(state)) return false;
      await writeActivity(tx, roomId, state);
      return true;
    });
    if (changed) activityEvents.emit(roomId);
  }
}

let lastArchiveCleanup = 0;
export async function cleanupWhiteboardArchives(now = Date.now()) {
  if (now - lastArchiveCleanup < 3600000) return;
  await db.transaction(async (tx) => {
    await lockWhiteboardArchives(tx);
    await tx.execute(
      sql`delete from whiteboard_snapshots s where s.created_at < now() - interval '1 day' and not exists(select 1 from whiteboard_records r where r.snapshot_id=s.id)`,
    );
    await tx.execute(sql`delete from whiteboard_images i where i.created_at < now() - interval '1 day'
      and not exists(select 1 from whiteboard_snapshots s where s.document->'elements' @> jsonb_build_array(jsonb_build_object('imageId',i.id::text)))
      and not exists(select 1 from room_activities a where (a.state->>'kind' <> 'idle' and a.state->>'id'=i.activity_id::text) or a.state::text like '%' || i.id::text || '%')`);
  });
  lastArchiveCleanup = now;
}

export async function activityPartyCatalog(user: User, roomId: string) {
  requireFeature(user, "room.activities");
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    await roomActivityAccess(tx, user, roomId);
    return listPartyCatalog(tx);
  });
}
