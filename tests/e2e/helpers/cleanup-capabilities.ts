import {
  createDatabase,
  users,
  rooms,
  auditLogs,
  credentials,
} from "@cinegather/database";
import { inArray } from "drizzle-orm";

const ids = process.argv.slice(2),
  url = process.env.DATABASE_URL!;
if (
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !ids.length ||
  ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))
)
  throw new Error("Local capability fixtures required");
const { db, pool } = createDatabase(url);
try {
  const accounts = await db
    .select({ username: users.username })
    .from(users)
    .where(inArray(users.id, ids));
  if (accounts.some((a) => !a.username?.startsWith("capsui_")))
    throw new Error("Unexpected fixture account");
  await db.transaction(async (tx) => {
    await tx.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await tx.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await tx.delete(credentials).where(inArray(credentials.userId, ids));
    await tx.delete(users).where(inArray(users.id, ids));
  });
} finally {
  await pool.end();
}
