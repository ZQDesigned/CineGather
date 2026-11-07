import { mkdir, writeFile, rename, unlink, chmod } from "node:fs/promises";
import { resolve } from "node:path";
const backupDir = resolve(".local/backups");
await mkdir(backupDir, { recursive: true, mode: 0o700 });
await chmod(backupDir, 0o700);
const output = resolve(
  backupDir,
  `cinegather-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`,
);
const temporary = `${output}.partial`;
await writeFile(temporary, "", { mode: 0o600, flag: "wx" });
const result = Bun.spawn(
  [
    "docker",
    "compose",
    "--env-file",
    ".env",
    "-f",
    "infra/compose/dev.yml",
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "cinegather",
    "-d",
    "cinegather",
    "-Fc",
  ],
  { stdout: Bun.file(temporary), stderr: "inherit" },
);
if ((await result.exited) !== 0 || Bun.file(temporary).size === 0) {
  await unlink(temporary);
  throw new Error("Database backup failed");
}
await rename(temporary, output);
console.log(`Backup written to ${output}`);
