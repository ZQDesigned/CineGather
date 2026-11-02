import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  utimes,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("native backup expires only top-level backups and preserves migration snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-native-backup-"));
  try {
    const bin = join(root, "bin");
    const backups = join(root, "backups");
    const migration = join(backups, "migration");
    await mkdir(bin);
    await mkdir(migration, { recursive: true });
    // Replace the external database process; exercise the real backup shell and filesystem.
    const pgDump = join(bin, "pg_dump");
    await writeFile(
      pgDump,
      '#!/bin/sh\nfor arg do\ncase "$arg" in --file=*) printf fixture > "${arg#--file=}";; esac\ndone\n',
    );
    await chmod(pgDump, 0o755);
    const name = "cinegather-20200101T000000Z.dump";
    const expired = join(backups, name);
    const snapshot = join(migration, name);
    for (const file of [expired, snapshot]) {
      await writeFile(file, "old snapshot");
      await utimes(file, new Date("2020-01-01"), new Date("2020-01-01"));
    }
    const result = Bun.spawnSync(
      ["/bin/sh", resolve("tools/native-backup.sh")],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          PGHOST: "unused",
          PGUSER: "unused",
          PGDATABASE: "unused",
          PGPASSWORD: "unused",
          CG_BACKUP_DIR: backups,
        },
      },
    );
    expect(result.exitCode).toBe(0);
    const files = await readdir(backups);
    expect(files).not.toContain(name);
    expect(await readFile(snapshot, "utf8")).toBe("old snapshot");
    expect(files.filter((file) => file.endsWith(".dump"))).toHaveLength(1);
    expect(await readFile(join(backups, "last-success"), "utf8")).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(files.some((file) => file.startsWith(".pending."))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
