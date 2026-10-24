import { createDatabase } from "@cinegather/database";
const url = process.env.DATABASE_URL!;
const username = process.argv[2],
  enabled = process.argv[3];
if (
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !/^e2e_[a-f0-9]{20}$/.test(username ?? "") ||
  !["true", "false"].includes(enabled ?? "")
)
  throw new Error("Local E2E fixture required");
const { pool } = createDatabase(url);
try {
  const r = await pool.query(
    "UPDATE users SET screen_share_enabled=$1 WHERE username=$2 RETURNING id",
    [enabled === "true", username],
  );
  if (r.rowCount !== 1) throw new Error("Fixture account not found");
} finally {
  await pool.end();
}
