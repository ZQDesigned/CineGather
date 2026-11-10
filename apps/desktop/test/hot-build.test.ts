import { pathToFileURL } from "node:url";
import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("packaging refuses a runtime descriptor from another platform or architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-build-gate-"));
  await mkdir(join(root, "resources"));
  await writeFile(
    join(root, "resources/desktop-runtime.json"),
    JSON.stringify({
      identity: { platform: "darwin", arch: "arm64", runtime: "a".repeat(64) },
    }),
  );
  const hook = resolve(
    import.meta.dir,
    "../../../packages/update-core/src/builder-hook.mjs",
  );
  try {
    for (const [platform, arch, status] of [
      ["darwin", 3, 0],
      ["win32", 1, 2],
      ["darwin", 1, 2],
    ] as const) {
      const child = Bun.spawn(
        [
          "node",
          "-e",
          `import(process.argv[1]).then(m=>m.default({packager:{info:{appDir:process.argv[2]}},electronPlatformName:process.argv[3],arch:Number(process.argv[4])})).catch(()=>process.exit(2))`,
          pathToFileURL(hook).href,
          root,
          platform,
          String(arch),
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      expect(await child.exited).toBe(status);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
