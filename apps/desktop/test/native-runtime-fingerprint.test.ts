import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
test("native runtime reuse invalidates on encoder input changes but not desktop versions or checkout line endings", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-runtime-inputs-"));
  const hash = () =>
    execFileSync("python3", ["native/capture/runtime-fingerprint.py", root], {
      encoding: "utf8",
    }).trim();
  try {
    await mkdir(join(root, "native/capture"), { recursive: true });
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "native/capture/encoder-selection.hpp"),
      "integrated-first\n",
    );
    await writeFile(join(root, "tools/windows-audio-build.ts"), "audio\n");
    const first = hash();
    await writeFile(join(root, "package.json"), '{"version":"0.1.28"}');
    expect(hash()).toBe(first);
    await writeFile(
      join(root, "native/capture/encoder-selection.hpp"),
      "integrated-first\r\n",
    );
    expect(hash()).toBe(first);
    await writeFile(
      join(root, "native/capture/encoder-selection.hpp"),
      "different-policy\n",
    );
    expect(hash()).not.toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
