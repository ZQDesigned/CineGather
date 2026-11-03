import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, createHash, sign } from "node:crypto";

for (const corrupted of [false, true])
  test(`released baseline ${corrupted ? "redownloads corrupt cache" : "reuses signed and digest-matched cache"}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-release-cache-"));
    try {
      await mkdir(join(dir, "apps/desktop/resources"), { recursive: true });
      await mkdir(join(dir, ".local/windows-upgrade"), { recursive: true });
      const { publicKey, privateKey } = generateKeyPairSync("ed25519"),
        bytes = Buffer.from("validated installer fixture");
      const payload = JSON.stringify({
        format: 1,
        platform: "win32",
        arch: "x64",
        version: "0.1.30",
        publishedAt: new Date().toISOString(),
        notes: "test fixture",
        artifact: {
          file: "CineGather-0.1.30-win-x64-setup.exe",
          size: bytes.length,
          sha512: createHash("sha512").update(bytes).digest("base64"),
        },
      });
      await writeFile(
        join(dir, "apps/desktop/resources/update-public-key.pem"),
        publicKey.export({ type: "spki", format: "pem" }),
      );
      await writeFile(
        join(dir, "feed.json"),
        JSON.stringify({
          payload,
          signature: sign(null, Buffer.from(payload), privateKey).toString(
            "base64",
          ),
        }),
      );
      await writeFile(join(dir, "installer.bin"), bytes);
      await writeFile(
        join(dir, ".local/windows-upgrade/released-setup.exe"),
        corrupted ? Buffer.from("corrupt cache") : bytes,
      );
      await writeFile(
        join(dir, "mock-fetch.ts"),
        `import{readFile,appendFile}from'node:fs/promises';globalThis.fetch=async(input)=>{const url=String(input);await appendFile('requests.log',url+'\\n');return url.includes('/updates/')?new Response(await readFile('feed.json')):new Response(await readFile('installer.bin'));};`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          "--preload",
          join(dir, "mock-fetch.ts"),
          resolve("tools/released-native-runtime.ts"),
          "--cached",
        ],
        { cwd: dir, stdout: "pipe", stderr: "pipe" },
      );
      const error = await new Response(child.stderr).text();
      expect(await child.exited, error).toBe(0);
      const requests = (await readFile(join(dir, "requests.log"), "utf8"))
        .trim()
        .split("\n");
      expect(requests.length).toBe(corrupted ? 2 : 1);
      expect(
        await readFile(join(dir, ".local/windows-upgrade/released-setup.exe")),
      ).toEqual(bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
