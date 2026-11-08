import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";

export function isolatedIntegrationUrl(raw: string) {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Integration tests require a PostgreSQL URL");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Integration tests require local PostgreSQL");
  url.pathname =
    "/cinegather_activities_tests_esports_" +
    randomUUID().replaceAll("-", "").slice(0, 12);
  return url;
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Run bun run setup before integration tests");
  const target = isolatedIntegrationUrl(base);
  const name = target.pathname.slice(1);
  const pool = new Pool({ connectionString: base, max: 1 });
  const cwd = resolve(import.meta.dir, "../..");
  const env = { ...process.env, DATABASE_URL: target.toString() };
  let created = false,
    interrupted = false;
  let child: { kill(): void } | undefined;
  const stop = () => {
    interrupted = true;
    child?.kill();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  async function execute(args: string[]) {
    if (interrupted) throw new Error("Integration tests interrupted");
    const next = Bun.spawn([process.execPath, ...args], {
      cwd,
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    child = next;
    try {
      return await next.exited;
    } finally {
      child = undefined;
    }
  }
  try {
    // The identifier is generated here, never supplied by the caller.
    await pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    console.log("Created isolated test database: " + name);
    if (await execute(["packages/database/src/migrate.ts"]))
      throw new Error("Integration database migration failed");
    process.exitCode = await execute([
      "test",
      "tests/integration",
      ...process.argv.slice(2).filter((arg) => arg !== "--"),
    ]);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    try {
      if (created) {
        await pool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",
          [name],
        );
        await pool.query(`DROP DATABASE "${name}"`);
        console.log("Removed isolated test database: " + name);
      }
    } finally {
      await pool.end();
    }
  }
}
if (import.meta.main) await main();
