import { and, eq, gt, isNull, isNotNull, or } from "drizzle-orm";
import {
  karaokeStages,
  karaokeSeats,
  credentials,
  members,
  roomSessions,
  users,
  roomMemberPermissions,
  type Database,
  type Transaction,
} from "@cinegather/database";
import { db } from "./context";
import { config } from "./config";
export async function activeKaraokeSeats(
  roomId: string,
  tx: Database | Transaction = db,
) {
  return tx
    .select({
      userId: karaokeSeats.userId,
      credentialId: karaokeSeats.credentialId,
    })
    .from(karaokeSeats)
    .innerJoin(credentials, eq(credentials.id, karaokeSeats.credentialId))
    .innerJoin(users, eq(users.id, karaokeSeats.userId))
    .innerJoin(
      members,
      and(
        eq(members.roomId, karaokeSeats.roomId),
        eq(members.userId, karaokeSeats.userId),
      ),
    )
    .innerJoin(
      roomSessions,
      and(
        eq(roomSessions.roomId, karaokeSeats.roomId),
        eq(roomSessions.credentialId, karaokeSeats.credentialId),
      ),
    )
    .leftJoin(
      roomMemberPermissions,
      and(
        eq(roomMemberPermissions.roomId, karaokeSeats.roomId),
        eq(roomMemberPermissions.userId, karaokeSeats.userId),
      ),
    )
    .where(
      and(
        eq(karaokeSeats.roomId, roomId),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, new Date()),
        isNull(users.disabledAt),
        isNotNull(members.admittedUntil),
        isNotNull(roomSessions.admittedUntil),
        or(
          isNull(roomMemberPermissions.userId),
          eq(roomMemberPermissions.microphoneAllowed, true),
        ),
      ),
    );
}
export async function karaokeSnapshot(
  roomId: string,
  credentialId?: string,
  tx: Database | Transaction = db,
) {
  const [stage] = await tx
    .select()
    .from(karaokeStages)
    .where(eq(karaokeStages.roomId, roomId));
  const seats = stage?.enabled ? await activeKaraokeSeats(roomId, tx) : [];
  return {
    enabled: stage?.enabled ?? false,
    revision: stage?.revision ?? 0,
    singers: seats.map((s) => s.userId),
    singing: seats.some((s) => s.credentialId === credentialId),
    serverTimeMs: Date.now(),
  };
}
export async function karaokeMicrophoneAllowed(
  roomId: string,
  userId: string,
  credentialId: string | undefined,
  allowed: boolean,
) {
  if (!allowed || !config.karaokePreview) return allowed;
  const stage = await karaokeSnapshot(roomId, credentialId);
  return !stage.enabled || (stage.singing && stage.singers.includes(userId));
}
