import { createDatabase } from "./index";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL missing. Run bun run setup.");
const { pool } = createDatabase(process.env.DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(839214)");
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log("Database migrations applied.");
} finally {
  await client.query("SELECT pg_advisory_unlock(839214)");
  client.release();
  await pool.end();
}
