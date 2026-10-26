import {
  createDatabase,
  users,
  credentials,
  auditLogs,
  friendships,
} from "@cinegather/database";
import { inArray, or } from "drizzle-orm";
import { z } from "zod";
const ids = z.array(z.uuid()).min(1).max(10).parse(process.argv.slice(2));
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
try {
  await db.transaction(async (tx) => {
    await tx
      .delete(friendships)
      .where(
        or(
          inArray(friendships.requesterId, ids),
          inArray(friendships.recipientId, ids),
        ),
      );
    await tx.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await tx.delete(credentials).where(inArray(credentials.userId, ids));
    await tx.delete(users).where(inArray(users.id, ids));
  });
} finally {
  await pool.end();
}
