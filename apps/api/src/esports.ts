import {
  requireShareQuality,
  validatePublicationQuality,
} from "./capabilities";
import type { Quality } from "@cinegather/contracts";
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  rooms,
  members,
  users,
  credentials,
  roomSessions,
  bans,
  roomMemberPermissions,
  esportsSeats,
  esportsWatches,
  esportsPublications,
  type Transaction,
} from "@cinegather/database";
import {
  memberIdentity,
  esportsSeatSchema,
  esportsSeatLimit,
  esportsChannelName,
  esportsMediaRights,
  esportsOwnVoice,
  ESPORTS_PREWARM_MS,
  ESPORTS_RESERVATION_MS,
  type EsportsSeat,
  type User,
  type esportsWatchInput,
  type esportsMonitorInput,
  type esportsConnectionInput,
} from "@cinegather/contracts";
import { TrackSource } from "livekit-server-sdk";
import { audit, db } from "./context";
import { fail, uuid } from "./errors";
import { sessionCredential } from "./session-context";
import { media } from "./media";
import {
  esportsReady,
  issueEsports,
  controlRights,
  removeEsportsChannel,
  removeEsportsMember,
  createEsportsNative,
  type EsportsScope,
  type EsportsRights,
} from "./esports-media";

type SeatRow = typeof esportsSeats.$inferSelect;
type WatchRow = typeof esportsWatches.$inferSelect;
const whereMember = (roomId: string, userId: string) =>
  and(eq(esportsSeats.roomId, roomId), eq(esportsSeats.userId, userId));
const whereWatch = (roomId: string, userId: string) =>
  and(eq(esportsWatches.roomId, roomId), eq(esportsWatches.userId, userId));
const wherePub = (roomId: string, userId: string) =>
  and(
    eq(esportsPublications.roomId, roomId),
    eq(esportsPublications.userId, userId),
  );
export const seatValue = (seat: Pick<SeatRow, "kind" | "team">): EsportsSeat =>
  esportsSeatSchema.parse(
    seat.kind === "player"
      ? { kind: seat.kind, team: seat.team }
      : { kind: seat.kind },
  );
function credential(user: User) {
  const id = sessionCredential(user);
  if (!id) fail(401, "SESSION_EXPIRED", "请重新登录账号");
  return id;
}
export async function esportsActor(
  tx: Transaction,
  roomId: string,
  userId: string,
  credentialId: string,
  write = true,
) {
  const query = tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, uuid(roomId)));
  const [room] = await query.for(write ? "update" : "share");
  if (!room || room.status !== "active")
    fail(404, "ROOM_NOT_FOUND", "房间不存在或已关闭");
  if (room.mode !== "esports")
    fail(400, "NOT_ESPORTS_ROOM", "此房间不是赛事房");
  const [actor] = await tx
    .select({ id: users.id })
    .from(credentials)
    .innerJoin(users, eq(users.id, credentials.userId))
    .innerJoin(
      roomSessions,
      and(
        eq(roomSessions.credentialId, credentials.id),
        eq(roomSessions.roomId, roomId),
      ),
    )
    .innerJoin(
      members,
      and(eq(members.roomId, roomId), eq(members.userId, users.id)),
    )
    .where(
      and(
        eq(credentials.id, credentialId),
        eq(users.id, userId),
        eq(credentials.kind, "account"),
        isNull(credentials.revokedAt),
        isNull(users.disabledAt),
        gt(credentials.expiresAt, new Date()),
        gt(roomSessions.admittedUntil, new Date()),
        gt(members.admittedUntil, new Date()),
      ),
    );
  const [ban] = await tx
    .select()
    .from(bans)
    .where(and(eq(bans.roomId, roomId), eq(bans.userId, userId)));
  if (!actor || ban)
    fail(403, "ESPORTS_ADMISSION_REQUIRED", "请重新加入赛事房");
  const [seat] = await tx
    .select()
    .from(esportsSeats)
    .where(whereMember(roomId, userId));
  if (!seat || seat.credentialId !== credentialId || seat.reservedUntil)
    fail(403, "ESPORTS_SEAT_EXPIRED", "席位已变更，请重新加入房间");
  const [policy] = await tx
    .select()
    .from(roomMemberPermissions)
    .where(
      and(
        eq(roomMemberPermissions.roomId, roomId),
        eq(roomMemberPermissions.userId, userId),
      ),
    );
  return {
    room,
    seat,
    policy: {
      microphoneAllowed: policy?.microphoneAllowed ?? true,
      sharingAllowed: policy?.sharingAllowed ?? true,
    },
  };
}
export async function esportsCapacity(
  tx: Transaction,
  roomId: string,
  userId: string,
  seat: EsportsSeat,
) {
  const seats = await tx
    .select()
    .from(esportsSeats)
    .where(eq(esportsSeats.roomId, roomId));
  const used = seats.filter(
    (s) =>
      s.userId !== userId &&
      s.kind === seat.kind &&
      (seat.kind !== "player" || s.team === seat.team),
  );
  if (used.length >= esportsSeatLimit(seat))
    fail(409, "ESPORTS_SEAT_FULL", "该席位已满，请选择其他席位");
}
export async function admitEsports(
  tx: Transaction,
  roomId: string,
  user: User,
  directed?: EsportsSeat,
) {
  esportsReady();
  const credentialId = credential(user);
  await sweepEsports(tx, roomId);
  const [old] = await tx
    .select()
    .from(esportsSeats)
    .where(whereMember(roomId, user.id));
  const seat =
    directed ??
    (old && (!old.reservedUntil || old.reservedUntil.getTime() > Date.now())
      ? seatValue(old)
      : ({ kind: "audience" } as const));
  await assertPlatform(tx, credentialId, seat);
  await esportsCapacity(tx, roomId, user.id, seat);
  if (old) await clearEsportsMember(tx, roomId, user.id, false);
  const revision = old ? old.revision + 1 : 1;
  await tx
    .insert(esportsSeats)
    .values({
      roomId,
      userId: user.id,
      credentialId,
      kind: seat.kind,
      team: seat.kind === "player" ? seat.team : null,
      revision,
    })
    .onConflictDoUpdate({
      target: [esportsSeats.roomId, esportsSeats.userId],
      set: {
        credentialId,
        kind: seat.kind,
        team: seat.kind === "player" ? seat.team : null,
        revision,
        reservedUntil: null,
      },
    });
  await tx
    .insert(esportsWatches)
    .values({ roomId, userId: user.id, credentialId })
    .onConflictDoNothing();
  return { revision, credentialId };
}
async function assertPlatform(tx: Transaction, id: string, seat: EsportsSeat) {
  const [session] = await tx
    .select({ platform: credentials.clientPlatform })
    .from(credentials)
    .where(eq(credentials.id, id));
  if (
    seat.kind !== "audience" &&
    (session?.platform === "ios" || session?.platform === "android")
  )
    fail(403, "ESPORTS_MOBILE_AUDIENCE_ONLY", "移动端目前仅支持观众席");
}
export async function esportsControlToken(
  tx: Transaction,
  roomId: string,
  user: User,
) {
  const [seat] = await tx
    .select()
    .from(esportsSeats)
    .where(whereMember(roomId, user.id));
  if (!seat) fail(403, "ESPORTS_SEAT_EXPIRED", "请重新加入赛事房");
  return issueEsports(
    user,
    {
      format: "esports-v1",
      roomId,
      userId: user.id,
      credentialId: credential(user),
      seatRevision: seat.revision,
    },
    controlRights,
  );
}
export async function snapshot(user: User, roomId: string) {
  return db.transaction(async (tx) => {
    const { room } = await esportsActor(tx, roomId, user.id, credential(user));
    await sweepEsports(tx, roomId);
    const seats = await tx
      .select({
        seat: esportsSeats,
        name: users.displayName,
        admitted: members.admittedUntil,
      })
      .from(esportsSeats)
      .innerJoin(users, eq(users.id, esportsSeats.userId))
      .innerJoin(
        members,
        and(
          eq(members.roomId, roomId),
          eq(members.userId, esportsSeats.userId),
        ),
      )
      .where(eq(esportsSeats.roomId, roomId));
    const policies = await tx
      .select()
      .from(roomMemberPermissions)
      .where(eq(roomMemberPermissions.roomId, roomId));
    const roster = seats.map(({ seat, name, admitted }) => {
      const p = policies.find((p) => p.userId === seat.userId);
      return {
        userId: seat.userId,
        displayName: name,
        seat: seatValue(seat),
        revision: seat.revision,
        online:
          !seat.reservedUntil && !!admitted && admitted.getTime() > Date.now(),
        reservedUntil: seat.reservedUntil?.toISOString() ?? null,
        microphoneAllowed: p?.microphoneAllowed ?? true,
        sharingAllowed: p?.sharingAllowed ?? true,
      };
    });
    const publications = await tx
      .select()
      .from(esportsPublications)
      .where(eq(esportsPublications.roomId, roomId));
    return {
      roomId,
      ownerUserId: room.ownerUserId,
      members: roster,
      self: roster.find((s) => s.userId === user.id)!,
      publications: publications.map((p) => ({
        id: p.id,
        userId: p.userId,
        status: p.videoActive ? ("active" as const) : ("starting" as const),
        systemAudio: p.systemAudio,
      })),
      watch: publicWatch(await watchRow(tx, roomId, user.id)),
    };
  });
}
export async function assignSeat(
  user: User,
  roomId: string,
  userId: string,
  seat: EsportsSeat,
) {
  await db.transaction(async (tx) => {
    const { room } = await esportsActor(tx, roomId, user.id, credential(user));
    if (room.ownerUserId !== user.id)
      fail(403, "FORBIDDEN", "仅房主可以分配席位");
    const [target] = await tx
      .select()
      .from(esportsSeats)
      .where(whereMember(roomId, uuid(userId)));
    if (!target || target.reservedUntil)
      fail(404, "ESPORTS_MEMBER_OFFLINE", "该成员当前不在线");
    await sweepEsports(tx, roomId);
    await assertPlatform(tx, target.credentialId, seat);
    await esportsCapacity(tx, roomId, userId, seat);
    if (JSON.stringify(seatValue(target)) === JSON.stringify(seat)) return;
    await clearEsportsMember(tx, roomId, userId, false);
    await tx
      .update(esportsSeats)
      .set({
        kind: seat.kind,
        team: seat.kind === "player" ? seat.team : null,
        revision: target.revision + 1,
      })
      .where(whereMember(roomId, userId));
    await tx
      .insert(esportsWatches)
      .values({ roomId, userId, credentialId: target.credentialId });
    await audit(tx, user.id, "esports.seat_changed", roomId, { userId, seat });
  });
  return snapshot(user, roomId);
}
async function watchRow(tx: Transaction, roomId: string, userId: string) {
  const [watch] = await tx
    .select()
    .from(esportsWatches)
    .where(whereWatch(roomId, userId));
  if (!watch) fail(409, "ESPORTS_WATCH_RESET", "观看状态已重置，请刷新房间");
  return watch;
}
const publicWatch = (w: WatchRow) => ({
  revision: w.revision,
  current: w.current,
  warming: w.warming,
  warmDeadline: w.warmDeadline?.toISOString() ?? null,
  monitorTeam: w.monitorTeam as "a" | "b" | null,
  autoMonitor: w.autoMonitor,
});
async function publication(tx: Transaction, roomId: string, id: string) {
  const [pub] = await tx
    .select({ pub: esportsPublications, team: esportsSeats.team })
    .from(esportsPublications)
    .innerJoin(
      esportsSeats,
      and(
        eq(esportsSeats.roomId, roomId),
        eq(esportsSeats.userId, esportsPublications.userId),
      ),
    )
    .where(
      and(
        eq(esportsPublications.roomId, roomId),
        eq(esportsPublications.id, id),
        gt(esportsPublications.expiresAt, new Date()),
      ),
    );
  if (!pub) fail(404, "ESPORTS_STREAM_ENDED", "该选手已停止共享");
  return pub;
}
async function closeVideo(roomId: string, userId: string, id: string | null) {
  if (id)
    await removeEsportsChannel(
      roomId,
      { kind: "video", publicationId: id },
      userId,
    );
}
async function setMonitor(tx: Transaction, w: WatchRow, team: string | null) {
  if (w.monitorTeam === team) return;
  if (w.monitorTeam)
    await removeEsportsChannel(
      w.roomId,
      { kind: "team", team: w.monitorTeam as "a" | "b" },
      w.userId,
    );
  await tx
    .update(esportsWatches)
    .set({ monitorTeam: team, monitorGrantId: team ? randomUUID() : null })
    .where(whereWatch(w.roomId, w.userId));
}
export async function changeWatch(
  user: User,
  roomId: string,
  input: z.infer<typeof esportsWatchInput>,
) {
  await db.transaction(async (tx) => {
    const { seat } = await esportsActor(tx, roomId, user.id, credential(user));
    if (seat.kind === "player")
      fail(403, "ESPORTS_PLAYER_CANNOT_WATCH", "选手席不支持观看其他共享");
    await sweepEsports(tx, roomId);
    const w = await watchRow(tx, roomId, user.id);
    // Expiry/reconciliation may already have removed this candidate. Cancelling
    // that exact warming slot is idempotent and must return the fresh revision.
    // It must never cancel a newer candidate selected by another pending action.
    if (
      input.action === "cancel" &&
      (!w.warming || (input.publicationId && w.warming !== input.publicationId))
    )
      return;
    if (w.revision !== input.revision)
      fail(409, "ESPORTS_WATCH_STALE", "观看选择已变更，请刷新后重试");
    if (input.action === "select") {
      const id = uuid(input.publicationId!);
      await publication(tx, roomId, id);
      if (w.current === id || w.warming === id) return;
      await closeVideo(roomId, user.id, w.warming);
      await tx
        .update(esportsWatches)
        .set({
          warming: id,
          warmGrantId: randomUUID(),
          warmDeadline: new Date(Date.now() + ESPORTS_PREWARM_MS),
          revision: w.revision + 1,
        })
        .where(whereWatch(roomId, user.id));
    } else if (input.action === "commit") {
      if (
        !w.warming ||
        w.warming !== input.publicationId ||
        !w.warmDeadline ||
        w.warmDeadline.getTime() <= Date.now()
      )
        fail(409, "ESPORTS_WARM_EXPIRED", "画面预热已失效，请重新选择");
      const p = await publication(tx, roomId, w.warming);
      await closeVideo(roomId, user.id, w.current);
      await setMonitor(
        tx,
        w,
        w.autoMonitor ? p.team : w.monitorTeam === p.team ? p.team : null,
      );
      await tx
        .update(esportsWatches)
        .set({
          current: w.warming,
          currentGrantId: w.warmGrantId,
          warming: null,
          warmGrantId: null,
          warmDeadline: null,
          revision: w.revision + 1,
        })
        .where(whereWatch(roomId, user.id));
    } else {
      await closeVideo(roomId, user.id, w.warming);
      if (input.action === "stop") {
        await closeVideo(roomId, user.id, w.current);
        await setMonitor(tx, w, null);
      }
      await tx
        .update(esportsWatches)
        .set({
          warming: null,
          warmGrantId: null,
          warmDeadline: null,
          revision: w.revision + 1,
          ...(input.action === "stop"
            ? { current: null, currentGrantId: null }
            : {}),
        })
        .where(whereWatch(roomId, user.id));
    }
    await audit(tx, user.id, "esports.watch_changed", roomId, {
      action: input.action,
      publicationId: input.publicationId,
    });
  });
  return snapshot(user, roomId);
}
export async function changeMonitor(
  user: User,
  roomId: string,
  input: z.infer<typeof esportsMonitorInput>,
) {
  await db.transaction(async (tx) => {
    const { seat } = await esportsActor(tx, roomId, user.id, credential(user));
    if (seat.kind === "player") fail(403, "FORBIDDEN", "选手只能收听本组语音");
    const w = await watchRow(tx, roomId, user.id),
      auto = input.autoMonitor ?? w.autoMonitor;
    const enabled =
      input.enabled ?? (input.autoMonitor === true ? true : !!w.monitorTeam);
    const p = w.current ? await publication(tx, roomId, w.current) : undefined;
    await setMonitor(tx, w, enabled ? (p?.team ?? null) : null);
    await tx
      .update(esportsWatches)
      .set({ autoMonitor: auto, revision: w.revision + 1 })
      .where(whereWatch(roomId, user.id));
  });
  return snapshot(user, roomId);
}
export async function scopeRights(
  tx: Transaction,
  scope: EsportsScope,
): Promise<EsportsRights> {
  const { seat, policy } = await esportsActor(
    tx,
    scope.roomId,
    scope.userId,
    scope.credentialId,
    false,
  );
  // Control carries no media rights; a seat change must not invalidate the
  // parent presence connection on its next automatic reconnect. Membership and
  // credential admission above still fence leave, bans and device takeover.
  if (!scope.channel) return controlRights;
  if (seat.revision !== scope.seatRevision)
    fail(409, "ESPORTS_SEAT_STALE", "席位已变更，请刷新房间");
  const channel = scope.channel;
  const [pub] = await tx
    .select()
    .from(esportsPublications)
    .where(
      and(
        eq(esportsPublications.roomId, scope.roomId),
        channel.kind === "video"
          ? eq(esportsPublications.id, channel.publicationId)
          : sql`false`,
        gt(esportsPublications.expiresAt, new Date()),
      ),
    );
  const own =
    !!pub &&
    pub.userId === scope.userId &&
    pub.credentialId === scope.credentialId &&
    pub.seatRevision === seat.revision;
  const rights = esportsMediaRights(seatValue(seat), channel, own);
  if (channel.kind === "video") {
    if (!pub) fail(403, "ESPORTS_STREAM_ENDED", "共享已结束");
    if (own) {
      if (pub.ingressId)
        fail(
          403,
          "ESPORTS_NATIVE_PUBLISHER_ACTIVE",
          "本次共享已使用原生推流通道",
        );
      if (!policy.sharingAllowed)
        fail(403, "SHARING_DISABLED", "房主已禁止你共享");
    } else {
      const w = await watchRow(tx, scope.roomId, scope.userId);
      if (
        !scope.grantId ||
        !(
          (w.current === channel.publicationId &&
            w.currentGrantId === scope.grantId) ||
          (w.warming === channel.publicationId &&
            w.warmGrantId === scope.grantId &&
            !!w.warmDeadline &&
            w.warmDeadline.getTime() > Date.now())
        )
      )
        fail(403, "ESPORTS_WATCH_DENIED", "该观看授权已失效");
    }
  } else if (channel.kind === "team" && seat.kind !== "player") {
    const w = await watchRow(tx, scope.roomId, scope.userId);
    if (
      !w.current ||
      w.monitorTeam !== channel.team ||
      !scope.grantId ||
      scope.grantId !== w.monitorGrantId
    )
      fail(403, "ESPORTS_MONITOR_DENIED", "该组选手语音未接入");
    await publication(tx, scope.roomId, w.current!);
  }
  if (!rights.publish && !rights.subscribe)
    fail(403, "ESPORTS_CHANNEL_DENIED", "当前席位无法连接该媒体通道");
  const publish =
    rights.publish &&
    (channel.kind === "video"
      ? policy.sharingAllowed
      : policy.microphoneAllowed);
  return {
    publish,
    subscribe: rights.subscribe,
    sources: publish
      ? channel.kind === "video"
        ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
        : [TrackSource.MICROPHONE]
      : [],
  };
}
export async function connection(
  user: User,
  roomId: string,
  input: z.infer<typeof esportsConnectionInput>,
) {
  return db.transaction(async (tx) => {
    const { seat } = await esportsActor(tx, roomId, user.id, credential(user));
    if (seat.revision !== input.seatRevision)
      fail(409, "ESPORTS_SEAT_STALE", "席位已变更，请刷新房间");
    const w = await watchRow(tx, roomId, user.id),
      c = input.channel;
    if (input.watchRevision !== undefined && input.watchRevision !== w.revision)
      fail(409, "ESPORTS_WATCH_STALE", "观看选择已变更");
    const grantId =
      c.kind === "video"
        ? w.current === c.publicationId
          ? w.currentGrantId
          : w.warming === c.publicationId
            ? w.warmGrantId
            : null
        : c.kind === "team" && seat.kind !== "player"
          ? w.monitorGrantId
          : null;
    const scope: EsportsScope = {
      format: "esports-v1",
      roomId,
      userId: user.id,
      credentialId: credential(user),
      seatRevision: seat.revision,
      channel: c,
      ...(grantId ? { grantId } : {}),
    };
    const rights = await scopeRights(tx, scope),
      channel = esportsChannelName(roomId, c);
    await media.ensureRoom(channel);
    return {
      channel,
      url: esportsReady(),
      token: await issueEsports(user, scope, rights),
      seatRevision: seat.revision,
    };
  });
}
export async function acquireEsportsLease(
  user: User,
  roomId: string,
  quality: Quality = "cinema",
) {
  return db.transaction(async (tx) => {
    const { seat, policy } = await esportsActor(
      tx,
      roomId,
      user.id,
      credential(user),
    );
    if (seat.kind !== "player" || !policy.sharingAllowed)
      fail(403, "ESPORTS_PUBLISH_DENIED", "仅允许有共享权限的选手推流");
    await requireShareQuality(tx, user.id, quality);
    const [old] = await tx
      .select()
      .from(esportsPublications)
      .where(wherePub(roomId, user.id));
    if (
      old &&
      old.expiresAt.getTime() > Date.now() &&
      old.credentialId === credential(user)
    ) {
      await validatePublicationQuality(tx, user.id, old.quality, quality);
      return leaseResult(old);
    }
    if (old) await stopEsportsPublication(tx, old);
    const p = {
      quality,
      roomId,
      userId: user.id,
      credentialId: credential(user),
      id: randomUUID(),
      leaseId: randomUUID(),
      revision: (old?.revision ?? 0) + 1,
      seatRevision: seat.revision,
      expiresAt: new Date(Date.now() + 30_000),
    };
    await tx.insert(esportsPublications).values(p);
    await audit(tx, user.id, "esports.share_started", roomId, {
      publicationId: p.id,
    });
    return leaseResult({
      ...p,
      systemAudio: false,
      videoActive: false,
      ingressId: null,
      identity: null,
    });
  });
}
const leaseResult = (p: typeof esportsPublications.$inferSelect) => ({
  roomId: p.roomId,
  holderUserId: p.userId,
  leaseId: p.leaseId,
  revision: p.revision,
  expiresAt: p.expiresAt.toISOString(),
  publicationId: p.id,
});
export async function renewEsportsLease(
  user: User,
  roomId: string,
  input: { leaseId: string; revision: number },
  release = false,
) {
  return db.transaction(async (tx) => {
    await esportsActor(tx, roomId, user.id, credential(user));
    const [p] = await tx
      .select()
      .from(esportsPublications)
      .where(wherePub(roomId, user.id));
    if (
      !p ||
      p.credentialId !== credential(user) ||
      p.leaseId !== input.leaseId ||
      p.revision !== input.revision ||
      p.expiresAt.getTime() <= Date.now()
    )
      fail(409, "LEASE_CONFLICT", "共享授权已失效");
    if (release) {
      await stopEsportsPublication(tx, p);
      return { ok: true as const };
    }
    await requireShareQuality(tx, user.id, p.quality);
    const expiresAt = new Date(Date.now() + 30_000);
    await tx
      .update(esportsPublications)
      .set({ expiresAt })
      .where(wherePub(roomId, user.id));
    return leaseResult({ ...p, expiresAt });
  });
}
export async function esportsNative(
  user: User,
  roomId: string,
  input: {
    leaseId: string;
    revision: number;
    systemAudio: boolean;
    quality?: Quality;
  },
) {
  return db.transaction(async (tx) => {
    const { seat, policy } = await esportsActor(
      tx,
      roomId,
      user.id,
      credential(user),
    );
    const [p] = await tx
      .select()
      .from(esportsPublications)
      .where(wherePub(roomId, user.id));
    if (
      seat.kind !== "player" ||
      !policy.sharingAllowed ||
      !p ||
      p.credentialId !== credential(user) ||
      p.leaseId !== input.leaseId ||
      p.revision !== input.revision ||
      p.expiresAt.getTime() <= Date.now()
    )
      fail(409, "LEASE_CONFLICT", "共享授权已失效");
    await validatePublicationQuality(tx, user.id, p.quality, input.quality);
    if (p.ingressId) {
      const info = await media.ingress.listIngress({ ingressId: p.ingressId });
      const existing = info[0];
      if (existing)
        return {
          url: existing.url,
          token: existing.streamKey,
          identity: existing.participantIdentity,
          expiresAt: p.expiresAt.toISOString(),
          publicationId: p.id,
        };
    }
    await removeEsportsChannel(
      roomId,
      { kind: "video", publicationId: p.id },
      user.id,
    );
    const info = await createEsportsNative(roomId, p.id, user, p.leaseId);
    try {
      await tx
        .update(esportsPublications)
        .set({
          ingressId: info.ingressId,
          identity: info.participantIdentity,
          systemAudio: input.systemAudio,
        })
        .where(wherePub(roomId, user.id));
    } catch (error) {
      await media.deleteNative(
        info.roomName,
        info.participantIdentity,
        info.ingressId,
      );
      throw error;
    }
    return {
      url: info.url,
      token: info.streamKey,
      identity: info.participantIdentity,
      expiresAt: p.expiresAt.toISOString(),
      publicationId: p.id,
    };
  });
}
export async function stopEsportsPublication(
  tx: Transaction,
  p: typeof esportsPublications.$inferSelect,
) {
  const channel = esportsChannelName(p.roomId, {
    kind: "video",
    publicationId: p.id,
  });
  if (p.ingressId && p.identity)
    await media.deleteNative(channel, p.identity, p.ingressId);
  await media.deleteRoom(channel);
  await tx.delete(esportsPublications).where(wherePub(p.roomId, p.userId));
  const watches = await tx
    .select()
    .from(esportsWatches)
    .where(eq(esportsWatches.roomId, p.roomId));
  for (const w of watches)
    if (w.current === p.id || w.warming === p.id) {
      if (w.current === p.id) await setMonitor(tx, w, null);
      await tx
        .update(esportsWatches)
        .set({
          revision: w.revision + 1,
          ...(w.current === p.id
            ? { current: null, currentGrantId: null }
            : {}),
          ...(w.warming === p.id
            ? { warming: null, warmGrantId: null, warmDeadline: null }
            : {}),
        })
        .where(whereWatch(p.roomId, w.userId));
    }
}
export async function clearEsportsMember(
  tx: Transaction,
  roomId: string,
  userId: string,
  release = true,
) {
  await removeEsportsMember(roomId, userId);
  const [p] = await tx
    .select()
    .from(esportsPublications)
    .where(wherePub(roomId, userId));
  if (p) await stopEsportsPublication(tx, p);
  await tx.delete(esportsWatches).where(whereWatch(roomId, userId));
  if (release) await tx.delete(esportsSeats).where(whereMember(roomId, userId));
}
export async function closeEsports(tx: Transaction, roomId: string) {
  const publications = await tx
    .select()
    .from(esportsPublications)
    .where(eq(esportsPublications.roomId, roomId));
  for (const p of publications) await stopEsportsPublication(tx, p);
  for (const channel of await media.client.listRooms())
    if (channel.name.startsWith(`cg-esports/${roomId}/`))
      await media.deleteRoom(channel.name);
  await tx.delete(esportsWatches).where(eq(esportsWatches.roomId, roomId));
  await tx.delete(esportsSeats).where(eq(esportsSeats.roomId, roomId));
}
export async function sweepEsports(tx: Transaction, roomId: string) {
  const publications = await tx
    .select()
    .from(esportsPublications)
    .where(eq(esportsPublications.roomId, roomId));
  for (const p of publications)
    if (p.expiresAt.getTime() <= Date.now())
      await stopEsportsPublication(tx, p);
  const watches = await tx
    .select()
    .from(esportsWatches)
    .where(eq(esportsWatches.roomId, roomId));
  for (const w of watches)
    if (w.warmDeadline && w.warmDeadline.getTime() <= Date.now()) {
      await closeVideo(roomId, w.userId, w.warming);
      await tx
        .update(esportsWatches)
        .set({
          warming: null,
          warmGrantId: null,
          warmDeadline: null,
          revision: w.revision + 1,
        })
        .where(whereWatch(roomId, w.userId));
    }
  const seats = await tx
    .select()
    .from(esportsSeats)
    .where(eq(esportsSeats.roomId, roomId));
  for (const s of seats)
    if (s.reservedUntil && s.reservedUntil.getTime() <= Date.now())
      await clearEsportsMember(tx, roomId, s.userId);
}
export async function reserveEsportsDisconnect(
  tx: Transaction,
  roomId: string,
  userId: string,
) {
  const [s] = await tx
    .select()
    .from(esportsSeats)
    .where(whereMember(roomId, userId));
  if (!s || s.reservedUntil) return;
  await clearEsportsMember(tx, roomId, userId, false);
  if (s.kind === "audience")
    await tx.delete(esportsSeats).where(whereMember(roomId, userId));
  else
    await tx
      .update(esportsSeats)
      .set({
        reservedUntil: new Date(Date.now() + ESPORTS_RESERVATION_MS),
        revision: s.revision + 1,
      })
      .where(whereMember(roomId, userId));
}

// The parent transports presence/control only. Never run the ordinary room's
// microphone permission repair against it.
export async function reconcileEsportsParent(
  tx: Transaction,
  roomId: string,
  disconnectedUserId?: string,
) {
  const peers = await media.participants(roomId, true);
  const seats = await tx
    .select()
    .from(esportsSeats)
    .where(eq(esportsSeats.roomId, roomId));
  const live: string[] = [];
  for (const s of seats) {
    const identity = memberIdentity(s.userId, s.credentialId);
    const peer = peers.find((p) => p.rawIdentity === identity);
    const [session] = await tx
      .select({ id: credentials.id, admitted: roomSessions.admittedUntil })
      .from(credentials)
      .innerJoin(users, eq(users.id, credentials.userId))
      .innerJoin(
        roomSessions,
        and(
          eq(roomSessions.roomId, roomId),
          eq(roomSessions.credentialId, credentials.id),
        ),
      )
      .where(
        and(
          eq(credentials.id, s.credentialId),
          isNull(credentials.revokedAt),
          gt(credentials.expiresAt, new Date()),
          isNull(users.disabledAt),
        ),
      );
    const [ban] = await tx
      .select()
      .from(bans)
      .where(and(eq(bans.roomId, roomId), eq(bans.userId, s.userId)));
    if (peer && session?.admitted && !ban && !s.reservedUntil) {
      live.push(s.userId);
      const until = new Date(Date.now() + 30_000);
      await tx
        .update(roomSessions)
        .set({ admittedUntil: until })
        .where(
          and(
            eq(roomSessions.roomId, roomId),
            eq(roomSessions.credentialId, s.credentialId),
          ),
        );
      await tx
        .update(members)
        .set({ admittedUntil: until })
        .where(and(eq(members.roomId, roomId), eq(members.userId, s.userId)));
      if (
        peer.permission?.canPublish ||
        peer.permission?.canSubscribe ||
        peer.tracks.length
      )
        await media.client.updateParticipant(roomId, identity, {
          permission: {
            canPublish: false,
            canSubscribe: false,
            canPublishData: false,
            canUpdateMetadata: false,
            canPublishSources: [],
          },
        });
    } else if (!session || ban) {
      await clearEsportsMember(tx, roomId, s.userId);
    } else if (
      s.userId === disconnectedUserId ||
      (!s.reservedUntil &&
        session.admitted &&
        session.admitted.getTime() <= Date.now())
    ) {
      await reserveEsportsDisconnect(tx, roomId, s.userId);
      await tx
        .update(roomSessions)
        .set({ admittedUntil: null })
        .where(
          and(
            eq(roomSessions.roomId, roomId),
            eq(roomSessions.credentialId, s.credentialId),
          ),
        );
      await tx
        .update(members)
        .set({ admittedUntil: null })
        .where(and(eq(members.roomId, roomId), eq(members.userId, s.userId)));
    }
  }
  for (const peer of peers)
    if (!live.includes(peer.identity))
      await media.remove(roomId, peer.rawIdentity ?? peer.identity);
  await sweepEsports(tx, roomId);
  const publications = await tx
    .select()
    .from(esportsPublications)
    .where(eq(esportsPublications.roomId, roomId));
  // Reconciliation samples each source once, rather than 20 viewers each
  // probing all ten SFU rooms on every snapshot poll.
  const statuses = await Promise.all(
    publications.map(async (p) => {
      const peers = await media.participants(
        esportsChannelName(roomId, { kind: "video", publicationId: p.id }),
      );
      return {
        p,
        systemAudio: peers.some(
          (peer) =>
            peer.identity === p.userId &&
            peer.tracks.some((t) => t.source === 4 && !t.muted),
        ),
        active: peers.some(
          (peer) =>
            peer.identity === p.userId &&
            peer.tracks.some((t) => t.source === 3 && !t.muted),
        ),
      };
    }),
  );
  for (const { p, active, systemAudio } of statuses)
    if (active !== p.videoActive || systemAudio !== p.systemAudio)
      await tx
        .update(esportsPublications)
        .set({ videoActive: active, systemAudio })
        .where(eq(esportsPublications.id, p.id));
  return live;
}
export async function applyEsportsPolicy(
  tx: Transaction,
  roomId: string,
  userId: string,
  microphoneAllowed: boolean,
  sharingAllowed: boolean,
) {
  const [s] = await tx
    .select()
    .from(esportsSeats)
    .where(whereMember(roomId, userId));
  if (!s) return;
  if (!sharingAllowed) {
    const [p] = await tx
      .select()
      .from(esportsPublications)
      .where(wherePub(roomId, userId));
    if (p) await stopEsportsPublication(tx, p);
  }
  // Update the own voice connection without touching receive-only monitoring.
  const channel = esportsChannelName(roomId, esportsOwnVoice(seatValue(s)));
  for (const peer of await media.participants(channel))
    if (peer.identity === userId)
      await media.client.updateParticipant(
        channel,
        peer.rawIdentity ?? peer.identity,
        {
          permission: {
            canPublish: microphoneAllowed,
            canSubscribe: true,
            canPublishData: false,
            canUpdateMetadata: false,
            canPublishSources: microphoneAllowed
              ? [TrackSource.MICROPHONE]
              : [],
          },
        },
      );
}
export async function muteEsportsMember(
  tx: Transaction,
  roomId: string,
  userId: string,
) {
  const [s] = await tx
    .select()
    .from(esportsSeats)
    .where(whereMember(roomId, userId));
  if (!s) return;
  const channel = esportsChannelName(roomId, esportsOwnVoice(seatValue(s)));
  await media.muteMicrophone(channel, userId, []);
  await media.control(userId, { action: "mute-microphone", roomId });
}

export async function stopEsportsMemberShare(
  tx: Transaction,
  roomId: string,
  userId: string,
  actorId: string,
) {
  const [p] = await tx
    .select()
    .from(esportsPublications)
    .where(wherePub(roomId, userId));
  if (!p) fail(409, "SHARE_CHANGED", "该成员的共享已结束");
  await stopEsportsPublication(tx, p);
  await audit(tx, actorId, "share.stopped_by_owner", roomId, {
    userId,
    leaseId: p.leaseId,
  });
  return p.leaseId;
}

export async function reconcileEsportsOrphans() {
  const channels = await media.client.listRooms();
  for (const channel of channels) {
    const match = /^cg-esports\/([0-9a-f-]{36})\//.exec(channel.name);
    if (!match) continue;
    await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, match[1]!))
        .for("update");
      if (!room || room.status !== "active" || room.mode !== "esports")
        await media.deleteRoom(channel.name);
    });
  }
  for (const ingress of await media.ingress.listIngress({}))
    if (ingress.name.startsWith("cinegather/esports/v1/")) {
      const match = /^cg-esports\/([0-9a-f-]{36})\/video\//.exec(
        ingress.roomName,
      );
      if (!match) continue;
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, match[1]!))
          .for("update");
        const [p] = await tx
          .select()
          .from(esportsPublications)
          .where(eq(esportsPublications.ingressId, ingress.ingressId));
        if (!p)
          await media.deleteNative(
            ingress.roomName,
            ingress.participantIdentity,
            ingress.ingressId,
          );
      });
    }
}

export async function stopAllEsportsShares(tx: Transaction, roomId: string) {
  for (const p of await tx
    .select()
    .from(esportsPublications)
    .where(eq(esportsPublications.roomId, roomId)))
    await stopEsportsPublication(tx, p);
}
