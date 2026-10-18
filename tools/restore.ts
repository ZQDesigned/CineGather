import { resolve } from "node:path";
const [file, target] = process.argv.slice(2);
if (!file || !target || !/^cinegather_restore_[a-z0-9_]+$/.test(target))
  throw new Error(
    "Usage: bun tools/restore.ts backup.dump cinegather_restore_NAME. Restore only to a new rehearsal database.",
  );
const prefix = [
  "docker",
  "compose",
  "--env-file",
  ".env",
  "-f",
  "infra/compose/dev.yml",
  "exec",
  "-T",
  "postgres",
];
const create = Bun.spawn([...prefix, "createdb", "-U", "cinegather", target], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await create.exited) !== 0)
  throw new Error("Target must be a new rehearsal database");
const restore = Bun.spawn(
  [
    ...prefix,
    "pg_restore",
    "-U",
    "cinegather",
    "-d",
    target,
    "--no-owner",
    "--exit-on-error",
  ],
  { stdin: Bun.file(resolve(file)), stdout: "inherit", stderr: "inherit" },
);
if ((await restore.exited) !== 0)
  throw new Error("Restore failed; inspect the rehearsal database");
console.log(`Restored into ${target}. Production database was not replaced.`);
