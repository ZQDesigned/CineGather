import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InstallerJournal,
  readInstallerDiagnostics,
} from "../src/main/installer-diagnostics";
import { diagnosticArchive } from "../src/shared/diagnostics";
import { unzipSync, strFromU8 } from "fflate";

test("installer history survives app restart, parses native UTF16 stages, bounds and strips unrelated data", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-install-history-"));
  try {
    const a = new InstallerJournal(root, "0.1.25");
    a.record("install-requested", {
      targetVersion: "0.1.26",
      path: "D:\\CGPlat\\CineGather",
      token: "DO-NOT-EXPORT",
    });
    const id = a.attempt;
    const ticks = BigInt(Date.now()) * 10000n + 116444736000000000n;
    await writeFile(
      join(root, "nsis-42-123.tsv"),
      Buffer.from(
        `v1\t${ticks}\t42\t${id}\t0.1.26\tatomic-rename-failed\tD:\\CGPlat\\CineGather\\resources\\app.asar\t2\t32\n`,
        "utf16le",
      ),
    );
    await writeFile(join(root, "account.json"), '{"token":"DO-NOT-EXPORT"}');
    await symlink(join(root, "account.json"), join(root, "snapshot-link.json"));
    const exported = await readInstallerDiagnostics(root);
    const text = JSON.stringify(exported);
    expect(text).toContain("atomic-rename-failed");
    expect(text).toContain("app.asar");
    expect(text).toContain('"win32Code":32');
    expect(text).toContain(id);
    expect(text).not.toContain("DO-NOT-EXPORT");
    expect(exported.records.length).toBe(2);
    const archive = unzipSync(await diagnosticArchive([], {}, {}, exported));
    expect(strFromU8(archive["upgrade/history.ndjson"]!)).toContain(
      "atomic-rename-failed",
    );
    expect(
      JSON.parse(strFromU8(archive["manifest.json"]!)).capabilities
        .installerHistory,
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt, missing and oversized installer evidence explicitly report gaps without breaking export", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-install-corrupt-"));
  try {
    await writeFile(
      join(root, "nsis-4-1.tsv"),
      Buffer.from("torn row\n", "utf16le"),
    );
    await writeFile(
      join(root, "snapshot-test.json"),
      "x".repeat(1024 * 1024 + 1),
    );
    const result = await readInstallerDiagnostics(root);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.records).toEqual([]);
    expect(
      (await readInstallerDiagnostics(join(root, "missing"))).available,
    ).toBe(false);
    await writeFile(join(root, "not-directory"), "x");
    const journal = new InstallerJournal(join(root, "not-directory"), "0.1.25");
    expect(() => journal.record("install-requested")).not.toThrow();
    expect(journal.failures).toBeGreaterThan(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retention removes only owned history, preserves other files and the current attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-install-retention-"));
  try {
    await writeFile(join(root, "leave-me.json"), "keep");
    for (let i = 0; i < 80; i++)
      await writeFile(join(root, `nsis-${i}-1.tsv`), "");
    const journal = new InstallerJournal(root, "0.1.25");
    journal.record("application-start");
    const names = await readdir(root);
    expect(names).toContain("leave-me.json");
    expect(
      names.filter((n) => n.startsWith("nsis-")).length,
    ).toBeLessThanOrEqual(63);
    expect(names.some((n) => n.includes(journal.attempt))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
