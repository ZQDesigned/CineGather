import {
  createDatabase,
  users,
  credentials,
  auditLogs,
  friendships,
  rooms,
  members,
  leases,
  invites,
  bans,
  roomMemberPermissions,
  idempotency,
  settings,
} from "@cinegather/database";
import { inArray, or } from "drizzle-orm";
import { z } from "zod";
const input = z
  .object({
    users: z.array(z.uuid()).min(1).max(20),
    rooms: z.array(z.uuid()).max(20),
  })
  .parse(JSON.parse(process.argv[2]!));
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
try {
  // A create/join can finish after a failing UI assertion. Include rooms owned
  // by these exact fixture users so late/archived rooms cannot be orphaned.
  const owned = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(inArray(rooms.ownerUserId, input.users));
  input.rooms = [...new Set([...input.rooms, ...owned.map((r) => r.id)])];
  await db.transaction(async (tx) => {
    if (input.rooms.length) {
      await tx.delete(invites).where(inArray(invites.roomId, input.rooms));
      await tx.delete(bans).where(inArray(bans.roomId, input.rooms));
      await tx
        .delete(roomMemberPermissions)
        .where(inArray(roomMemberPermissions.roomId, input.rooms));
      await tx.delete(leases).where(inArray(leases.roomId, input.rooms));
      await tx.delete(members).where(inArray(members.roomId, input.rooms));
      await tx.delete(rooms).where(inArray(rooms.id, input.rooms));
    }
    await tx
      .delete(friendships)
      .where(
        or(
          inArray(friendships.requesterId, input.users),
          inArray(friendships.recipientId, input.users),
        ),
      );
    await tx.delete(auditLogs).where(inArray(auditLogs.actorId, input.users));
    await tx
      .delete(idempotency)
      .where(inArray(idempotency.userId, input.users));
    await tx.delete(settings).where(inArray(settings.userId, input.users));
    await tx
      .delete(credentials)
      .where(inArray(credentials.userId, input.users));
    await tx.delete(users).where(inArray(users.id, input.users));
  });
} finally {
  await pool.end();
}
