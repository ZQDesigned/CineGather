import { createDatabase } from "@cinegather/database";
const url = process.env.DATABASE_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Registration fixture cleanup is local-only");
const { pool } = createDatabase(url);
const client = await pool.connect();
try {
  const id = process.argv[2];
  const { rows } = await client.query(
    "SELECT id FROM users WHERE id=$1 AND username ~ '^regui_[0-9a-f]{8}$'",
    [id],
  );
  if (rows.length !== 1) throw new Error("Registration fixture not found");
  await client.query("BEGIN");
  await client.query("DELETE FROM registration_policy");
  await client.query(
    "DELETE FROM audit_logs WHERE actor_id=$1 OR target_id=$1",
    [id],
  );
  await client.query("DELETE FROM users WHERE id=$1", [id]);
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
