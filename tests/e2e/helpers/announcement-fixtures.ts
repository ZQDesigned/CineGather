import { createDatabase, users, announcements } from "@cinegather/database";
import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
const input = z
  .object({
    operation: z.enum(["grant", "cleanup"]),
    users: z.array(z.uuid()).min(1).max(10),
  })
  .parse(JSON.parse(process.argv[2]!));
const url = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw Error("Announcement fixtures require a local database");
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
try {
  const selected = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, input.users), like(users.username, "e2e_%")));
  if (selected.length !== input.users.length)
    throw Error("Only exact E2E fixture accounts can be changed");
  if (input.operation === "grant") {
    await db
      .update(users)
      .set({ isSuperAdmin: true })
      .where(eq(users.id, input.users[0]!));
  } else
    await db
      .delete(announcements)
      .where(inArray(announcements.createdBy, input.users));
} finally {
  await pool.end();
}
