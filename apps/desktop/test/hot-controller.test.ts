import { test, expect } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publishBundle } from "@cinegather/update-core";
import { HotStore } from "../src/main/updates/hot/store";
import {
  HotController,
  boundedFetch,
} from "../src/main/updates/hot/controller";
async function fixture(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), "cg-controller-")),
    factory = join(root, "factory"),
    input = join(root, "input"),
    output = join(root, "output");
  await mkdir(factory);
  await mkdir(input);
  await writeFile(join(factory, "index.html"), "factory");
  await writeFile(join(input, "index.html"), "updated");
  const k = generateKeyPairSync("ed25519"),
    publicKey = k.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey = k.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
  const identity = {
    platform: "darwin" as const,
    arch: "arm64" as const,
    runtime: "7".repeat(64),
  };
  await publishBundle({
    input,
    output,
    identity,
    privateKey,
    revision: 1,
    sequence: 1,
    minimumRevision: 1,
    featureMinimums: {},
    notes: "",
  });
  const store = new HotStore({
    root: join(root, "cache"),
    factory,
    publicKey,
    identity,
  });
  let nativeBusy = false,
    safe = true,
    loads = 0,
    requests = 0;
  const controller = new HotController(store, {
    enabled,
    fetch: async (path) => {
      requests++;
      return readFile(
        join(
          output,
          path.startsWith("policy?")
            ? `policies/darwin-arm64/${identity.runtime}.json`
            : path,
        ),
      );
    },
    changed: () => {},
    prepare: async () => safe,
    nativeBusy: () => nativeBusy,
    load: async () => {
      loads++;
    },
    log: () => {},
  });
  await controller.initialize();
  await controller.ready("factory");
  return {
    controller,
    store,
    get loads() {
      return loads;
    },
    get requests() {
      return requests;
    },
    setNative: (v: boolean) => (nativeBusy = v),
    setSafe: (v: boolean) => (safe = v),
  };
}
test("forced hot update preserves room/native business and requires fresh preparation", async () => {
  const f = await fixture();
  await f.controller.check();
  expect(f.controller.snapshot().required).toBe(true);
  expect(f.controller.snapshot().phase).toBe("ready");
  expect(await f.controller.apply()).toBe(false);
  f.controller.activity(false);
  f.setNative(true);
  expect(await f.controller.apply()).toBe(false);
  f.setNative(false);
  f.setSafe(false);
  expect(await f.controller.apply()).toBe(false);
  expect(f.loads).toBe(0);
  f.setSafe(true);
  expect(await f.controller.apply()).toBe(true);
  expect(f.loads).toBe(1);
  expect(f.controller.locked).toBe(true);
  await f.controller.ready(f.store.current);
  expect(f.controller.locked).toBe(false);
  expect(f.controller.snapshot().required).toBe(false);
  f.controller.dispose();
});
test("portable installation neither requests nor loads cached hot updates", async () => {
  const f = await fixture(false);
  await f.controller.check();
  await f.controller.download();
  expect(await f.controller.apply()).toBe(false);
  expect(f.requests).toBe(0);
  expect(f.store.current).toBe("factory");
  f.controller.dispose();
});
test("download enforces the streaming size even without a Content-Length header", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("too large for limit"),
  });
  try {
    await expect(boundedFetch(server.url.href, 3)).rejects.toThrow();
  } finally {
    server.stop(true);
  }
});
test("corrupted pending assets cannot prevent factory startup", async () => {
  const f = await fixture();
  await f.controller.check();
  const file = (await f.store.manifest(f.store.pending!)).files[0]!;
  await writeFile(join(f.store.options.root, "assets", file.sha256), "broken");
  const restarted = new HotController(new HotStore(f.store.options), {
    enabled: true,
    fetch: async () => undefined,
    changed: () => {},
    prepare: async () => true,
    nativeBusy: () => false,
    load: async () => {},
    log: () => {},
  });
  await restarted.initialize();
  expect((await restarted.identity()).bundleId).toBe("factory");
  f.controller.dispose();
  restarted.dispose();
});
test("unwritable update storage does not prevent installed UI startup", async () => {
  const f = await fixture();
  const blocked = join(f.store.options.root, "blocked");
  await writeFile(blocked, "not a directory");
  const store = new HotStore({ ...f.store.options, root: blocked });
  const controller = new HotController(store, {
    enabled: true,
    fetch: async () => undefined,
    changed: () => {},
    prepare: async () => true,
    nativeBusy: () => false,
    load: async () => {},
    log: () => {},
  });
  await controller.initialize();
  expect((await controller.identity()).bundleId).toBe("factory");
  expect(controller.snapshot().phase).toBe("error");
  controller.dispose();
  f.controller.dispose();
});
test("activation allows startup settings/status and cleanup while refusing new native work", async () => {
  const { hotIPCAllowed } = await import("../src/main/updates/hot/ipc-policy");
  for (const channel of [
    "desktop:settings-load",
    "desktop:hot-ready",
    "desktop:update-status",
    "desktop:hotkey-status",
    "desktop:native-stop",
  ])
    expect(hotIPCAllowed(channel)).toBe(true);
  for (const channel of [
    "desktop:native-start",
    "desktop:settings-save",
    "desktop:game-configure",
    "desktop:accompaniment-start",
    "desktop:shortcut-record",
    "desktop:select-source",
    "desktop:update-install",
  ])
    expect(hotIPCAllowed(channel)).toBe(false);
});
