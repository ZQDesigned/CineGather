import { requireFeature } from "./feature-policy";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import {
  rooms,
  esportsSeats,
  invites,
  type Transaction,
} from "@cinegather/database";
import {
  esportsConfigurationSchema,
  esportsCapacityTotal,
  esportsOwnVoice,
  esportsChannelName,
  coachVoiceAllowed,
  coachVoiceModeSchema,
  type CoachVoiceMode,
  type User,
  type esportsSettingsInput,
} from "@cinegather/contracts";
import type { z } from "zod";
import { db, audit } from "./context";
import { esportsActor, snapshot, sweepEsports } from "./esports";
import { supportsDynamicEsports, sessionCredential } from "./session-context";
import { fail } from "./errors";
import { media } from "./media";
export const readEsportsConfiguration = (room: typeof rooms.$inferSelect) =>
  esportsConfigurationSchema.parse(room.esportsConfiguration);
export const roomCoachVoiceAllowed = (room: typeof rooms.$inferSelect) =>
  coachVoiceAllowed(
    coachVoiceModeSchema.parse(room.coachVoiceMode),
    room.tacticalPauseUntil,
  );
async function requireModern(tx: Transaction, roomId: string, user: User) {
  requireFeature(user, "room.esports", 2);
  if (!supportsDynamicEsports(user))
    fail(426, "ESPORTS_CLIENT_UNSUPPORTED", "请更新客户端后调整赛事房");
  const seats = await tx
    .select()
    .from(esportsSeats)
    .where(eq(esportsSeats.roomId, roomId));
  if (seats.some((s) => s.featureVersion < 2))
    fail(
      409,
      "ESPORTS_MEMBERS_NEED_UPDATE",
      "房间内有成员需要更新客户端后重新进入，才能使用新赛事功能",
    );
}
async function owner(tx: Transaction, user: User, roomId: string) {
  const context = await esportsActor(
    tx,
    roomId,
    user.id,
    sessionCredential(user)!,
  );
  if (context.room.ownerUserId !== user.id)
    fail(403, "FORBIDDEN", "仅房主可以调整赛事房");
  await sweepEsports(tx, roomId);
  await requireModern(tx, roomId, user);
  return context.room;
}
async function revokeCoachVoice(tx: Transaction, roomId: string) {
  const coaches = await tx
    .select()
    .from(esportsSeats)
    .where(
      and(eq(esportsSeats.roomId, roomId), eq(esportsSeats.kind, "coach")),
    );
  for (const coach of coaches)
    await media.remove(
      esportsChannelName(
        roomId,
        esportsOwnVoice({ kind: "coach", team: coach.team! }),
      ),
      coach.userId,
    );
}
export async function updateEsportsConfiguration(
  user: User,
  roomId: string,
  input: z.infer<typeof esportsSettingsInput>,
) {
  await db.transaction(async (tx) => {
    const room = await owner(tx, user, roomId);
    await sweepEsports(tx, roomId);
    if (room.esportsRevision !== input.revision)
      fail(
        409,
        "ESPORTS_CONFIGURATION_CHANGED",
        "房间设置已变更，请重新打开后修改",
      );
    const seats = await tx
      .select()
      .from(esportsSeats)
      .where(eq(esportsSeats.roomId, roomId));
    for (const s of seats)
      if (s.kind === "player" || s.kind === "coach") {
        const g = input.configuration.groups.find((g) => g.id === s.team);
        if (!g)
          fail(409, "ESPORTS_GROUP_OCCUPIED", "请先调整本组成员，再删除分组");
        const count = seats.filter(
          (o) => o.kind === s.kind && o.team === s.team,
        ).length;
        if (count > (s.kind === "coach" ? g.coachSeats : g.playerSeats))
          fail(409, "ESPORTS_GROUP_OCCUPIED", "请先调整本组成员，再减少席位");
      }
    const removed = readEsportsConfiguration(room).groups.filter(
      (g) => !input.configuration.groups.some((n) => n.id === g.id),
    );
    for (const g of removed)
      await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.roomId, roomId), eq(invites.esportsTeam, g.id)));
    await tx
      .update(rooms)
      .set({
        name: input.name ?? room.name,
        esportsConfiguration: input.configuration,
        esportsRevision: room.esportsRevision + 1,
        esportsAdvanced: true,
        maxMembers: esportsCapacityTotal(input.configuration),
      })
      .where(eq(rooms.id, roomId));
    await audit(tx, user.id, "esports.configuration_updated", roomId, {
      configuration: input.configuration,
    });
  });
  return snapshot(user, roomId);
}
export async function expireTacticalPause(
  tx: Transaction,
  room: typeof rooms.$inferSelect,
) {
  if (
    !room.tacticalPauseUntil ||
    room.tacticalPauseUntil.getTime() > Date.now()
  )
    return room;
  if (room.coachVoiceMode === "auto") await revokeCoachVoice(tx, room.id);
  const [updated] = await tx
    .update(rooms)
    .set({
      tacticalPauseUntil: null,
      coachVoiceRevision:
        room.coachVoiceRevision + (room.coachVoiceMode === "auto" ? 1 : 0),
    })
    .where(eq(rooms.id, room.id))
    .returning();
  await audit(tx, null, "esports.pause_expired", room.id);
  return updated!;
}
export async function setTacticalPause(
  user: User,
  roomId: string,
  active: boolean,
) {
  await db.transaction(async (tx) => {
    const room = await expireTacticalPause(tx, await owner(tx, user, roomId));
    const until = active
      ? new Date(
          Date.now() +
            readEsportsConfiguration(room).tacticalPauseSeconds * 1000,
        )
      : null;
    const before = roomCoachVoiceAllowed(room),
      after = coachVoiceAllowed(
        coachVoiceModeSchema.parse(room.coachVoiceMode),
        until,
      );
    if (before !== after) await revokeCoachVoice(tx, roomId);
    await tx
      .update(rooms)
      .set({
        tacticalPauseUntil: until,
        coachVoiceRevision:
          room.coachVoiceRevision + (before !== after ? 1 : 0),
        esportsAdvanced: true,
      })
      .where(eq(rooms.id, roomId));
    await audit(
      tx,
      user.id,
      active ? "esports.pause_started" : "esports.pause_ended",
      roomId,
      { until: until?.toISOString() ?? null },
    );
  });
  return snapshot(user, roomId);
}
export async function setCoachVoiceMode(
  user: User,
  roomId: string,
  mode: CoachVoiceMode,
) {
  await db.transaction(async (tx) => {
    const room = await expireTacticalPause(tx, await owner(tx, user, roomId));
    if (room.coachVoiceMode === mode) return;
    const changed =
      roomCoachVoiceAllowed(room) !==
      coachVoiceAllowed(mode, room.tacticalPauseUntil);
    if (changed) await revokeCoachVoice(tx, roomId);
    await tx
      .update(rooms)
      .set({
        coachVoiceMode: mode,
        coachVoiceRevision: room.coachVoiceRevision + (changed ? 1 : 0),
        esportsAdvanced: true,
      })
      .where(eq(rooms.id, roomId));
    await audit(tx, user.id, "esports.coach_voice_changed", roomId, { mode });
  });
  return snapshot(user, roomId);
}
export async function reconcileTacticalPauses() {
  const expired = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      and(
        eq(rooms.mode, "esports"),
        eq(rooms.status, "active"),
        isNotNull(rooms.tacticalPauseUntil),
        lte(rooms.tacticalPauseUntil, new Date()),
      ),
    );
  for (const r of expired)
    await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, r.id))
        .for("update");
      if (room?.status === "active") await expireTacticalPause(tx, room);
    });
}
