import { test, expect } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishBundle } from "@cinegather/update-core";
import { HotStore } from "../src/main/updates/hot/store";
const keys = generateKeyPairSync("ed25519"),
  privateKey = keys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const identity = {
  platform: "win32" as const,
  arch: "x64" as const,
  runtime: "1".repeat(64),
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cg-hot-")),
    factory = join(root, "factory"),
    input = join(root, "input"),
    output = join(root, "published");
  await mkdir(factory);
  await mkdir(input);
  await writeFile(join(factory, "index.html"), "factory");
  await writeFile(join(input, "index.html"), "new UI");
  const pub = await publishBundle({
    input,
    output,
    identity,
    privateKey,
    revision: 1,
    sequence: 1,
    minimumRevision: 1,
    featureMinimums: {},
    notes: "test",
  });
  const options = { root: join(root, "cache"), factory, identity, publicKey };
  const transport = async (path: string) => readFile(join(output, path));
  return { ...pub, options, transport, output };
}
test("a staged bundle is pinned, verifies bytes at read, and rolls back an unacknowledged boot", async () => {
  const f = await fixture(),
    store = new HotStore(f.options);
  await store.initialize();
  await store.accept(
    await f.transport(`policies/win32-x64/${identity.runtime}.json`),
  );
  await store.stage(f.transport);
  expect(store.current).toBe("factory");
  await store.begin();
  expect(
    (await store.resource(`app://cinegather/ui/${f.bundleId}/index.html`))
      .status,
  ).toBe(200);
  await writeFile(
    join(f.options.root, "assets", f.manifest.files[0]!.sha256),
    "corrupt",
  );
  expect(
    (await store.resource(`app://cinegather/ui/${f.bundleId}/index.html`))
      .status,
  ).toBe(503);
  const restart = new HotStore(f.options);
  await restart.initialize();
  expect(restart.current).toBe("factory");
  expect(restart.quarantined).toContain(f.bundleId);
});
test("ready candidate survives restart; failed downloads preserve factory; old signed policy cannot replay", async () => {
  const f = await fixture(),
    store = new HotStore(f.options);
  await store.initialize();
  const raw = await f.transport(`policies/win32-x64/${identity.runtime}.json`);
  await store.accept(raw);
  await expect(
    store.stage(async () => Buffer.from("partial")),
  ).rejects.toThrow();
  expect(store.current).toBe("factory");
  await store.stage(f.transport);
  await store.begin();
  await store.ready(f.bundleId);
  const restart = new HotStore(f.options);
  await restart.initialize();
  expect(restart.current).toBe(f.bundleId);
  const second = await publishBundle({
    input: f.options.factory,
    output: f.output,
    identity,
    privateKey,
    revision: 2,
    sequence: 2,
    minimumRevision: 1,
    featureMinimums: {},
    notes: "rollback content",
  });
  await restart.accept(
    await f.transport(`policies/win32-x64/${identity.runtime}.json`),
  );
  await expect(restart.accept(raw)).rejects.toThrow();
  expect(second.policy.revision).toBe(2);
  expect(
    (await restart.resource(`app://cinegather/ui/${f.bundleId}/%2e%2e/secret`))
      .status,
  ).not.toBe(200);
  expect(
    (await restart.resource("app://other/ui/factory/index.html")).status,
  ).toBe(403);
});
