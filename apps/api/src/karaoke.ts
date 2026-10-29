import { and, eq, notInArray, isNull, gt, sql } from "drizzle-orm";
import {
  karaokeStages,
  karaokeSeats,
  credentials,
  roomMemberPermissions,
  roomSessions,
} from "@cinegather/database";
import { memberSession, type User } from "@cinegather/contracts";
import { db, audit } from "./context";
import { config } from "./config";
import { fail, uuid } from "./errors";
import { requireMember } from "./rooms";
import { sessionCredential } from "./session-context";
import { activeKaraokeSeats, karaokeSnapshot } from "./karaoke-state";
import { media } from "./media";
function preview() {
  if (!config.karaokePreview)
    fail(404, "KARAOKE_UNAVAILABLE", "合唱验证暂未开放");
}
// Runs after the database commit; all permission writes also consult the latest
// stage, so an older concurrent request cannot restore a revoked singing grant.
async function syncPermissions(roomId: string) {
  const policies = await db
    .select()
    .from(roomMemberPermissions)
    .where(eq(roomMemberPermissions.roomId, roomId));
  for (const p of await media.participants(roomId)) {
    const identity = p.rawIdentity ?? p.identity;
    if (!memberSession(identity)) continue;
    await media.setPermissions(
      roomId,
      identity,
      policies.find((v) => v.userId === p.identity)?.microphoneAllowed !==
        false,
      p.permission?.canPublishSources.some((s) => s === 3 || s === 4) ?? false,
    );
  }
}
export async function getKaraoke(user: User, roomId: string) {
  preview();
  return db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    return karaokeSnapshot(roomId, sessionCredential(user), tx);
  });
}
export async function setKaraoke(user: User, roomId: string, enabled: boolean) {
  preview();
  roomId = uuid(roomId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, true, true);
    await tx
      .insert(karaokeStages)
      .values({ roomId, enabled, revision: 1 })
      .onConflictDoUpdate({
        target: karaokeStages.roomId,
        set: { enabled, revision: sql`${karaokeStages.revision}+1` },
      });
    if (!enabled)
      await tx.delete(karaokeSeats).where(eq(karaokeSeats.roomId, roomId));
    await audit(
      tx,
      user.id,
      enabled ? "karaoke.enabled" : "karaoke.disabled",
      roomId,
    );
  });
  await syncPermissions(roomId);
  return karaokeSnapshot(roomId, sessionCredential(user));
}
export async function joinKaraoke(user: User, roomId: string) {
  preview();
  roomId = uuid(roomId);
  const credentialId = sessionCredential(user);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, false, true);
    const current = await karaokeSnapshot(roomId, credentialId, tx);
    if (!current.enabled) fail(409, "KARAOKE_DISABLED", "房主尚未开启合唱");
    const [session] = await tx
      .select()
      .from(credentials)
      .where(
        and(
          eq(
            credentials.id,
            credentialId ?? "00000000-0000-0000-0000-000000000000",
          ),
          eq(credentials.userId, user.id),
          isNull(credentials.revokedAt),
          gt(credentials.expiresAt, new Date()),
        ),
      );
    if (!session || !["darwin", "win32"].includes(session.clientPlatform))
      fail(
        403,
        "KARAOKE_DESKTOP_REQUIRED",
        "合唱暂需使用 Windows 或 macOS 客户端，网页版可以听歌",
      );
    const [admission] = await tx
      .select()
      .from(roomSessions)
      .where(
        and(
          eq(roomSessions.roomId, roomId),
          eq(roomSessions.credentialId, session.id),
        ),
      );
    if (!admission?.admittedUntil)
      fail(403, "KARAOKE_NOT_CONNECTED", "请先连接房间");
    const [policy] = await tx
      .select()
      .from(roomMemberPermissions)
      .where(
        and(
          eq(roomMemberPermissions.roomId, roomId),
          eq(roomMemberPermissions.userId, user.id),
        ),
      );
    if (policy?.microphoneAllowed === false)
      fail(403, "MICROPHONE_FORBIDDEN", "房主已禁止你在此房间开麦");
    const live = await activeKaraokeSeats(roomId, tx);
    await tx.delete(karaokeSeats).where(
      and(
        eq(karaokeSeats.roomId, roomId),
        live.length
          ? notInArray(
              karaokeSeats.credentialId,
              live.map((s) => s.credentialId),
            )
          : undefined,
      ),
    );
    if (live.some((s) => s.credentialId === session.id)) return;
    if (live.some((s) => s.userId === user.id))
      fail(409, "KARAOKE_OTHER_DEVICE", "你的其他设备已加入合唱，请先退出");
    if (live.length >= 4)
      fail(409, "KARAOKE_FULL", "合唱席位已满，最多同时 4 人");
    await tx
      .insert(karaokeSeats)
      .values({ roomId, userId: user.id, credentialId: session.id });
    await tx
      .update(karaokeStages)
      .set({ revision: sql`${karaokeStages.revision}+1` })
      .where(eq(karaokeStages.roomId, roomId));
    await audit(tx, user.id, "karaoke.joined", roomId);
  });
  await syncPermissions(roomId);
  return karaokeSnapshot(roomId, credentialId);
}
export async function leaveKaraoke(
  user: User,
  roomId: string,
  targetId: string,
) {
  preview();
  roomId = uuid(roomId);
  targetId = uuid(targetId);
  await db.transaction(async (tx) => {
    await requireMember(tx, roomId, user.id, targetId !== user.id, true);
    await tx
      .delete(karaokeSeats)
      .where(
        and(
          eq(karaokeSeats.roomId, roomId),
          eq(karaokeSeats.userId, targetId),
          targetId === user.id
            ? eq(karaokeSeats.credentialId, sessionCredential(user)!)
            : undefined,
        ),
      );
    await tx
      .update(karaokeStages)
      .set({ revision: sql`${karaokeStages.revision}+1` })
      .where(eq(karaokeStages.roomId, roomId));
    await audit(tx, user.id, "karaoke.left", roomId, { userId: targetId });
  });
  await syncPermissions(roomId);
  return karaokeSnapshot(roomId, sessionCredential(user));
}
