import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import {
  UpdateScheduler,
  UPDATE_INTERVAL,
  automaticallyDownload,
} from "../src/main/update-scheduler";
import {
  PendingUpdateStore,
  installPendingUpdate,
} from "../src/main/pending-update";
import { verifyRelease } from "../src/main/update-release";
import { UpdateController } from "../src/main/update-controller";
import { defaultSettings, settingsSchema } from "../src/shared/settings";
test("automatic checks run once per hour, coalesce resume and do not retry rapidly on errors", async () => {
  let now = 0,
    queued: (() => void) | undefined,
    delay = 0,
    calls = 0,
    finish!: () => void;
  const scheduler = new UpdateScheduler(
    async () => {
      calls++;
      await new Promise<void>((r) => (finish = r));
    },
    {
      now: () => now,
      set: (fn, ms) => {
        queued = fn;
        delay = ms;
        return 1;
      },
      clear: () => {
        queued = undefined;
      },
    },
  );
  scheduler.start();
  expect(delay).toBe(20000);
  now = 20000;
  queued!();
  await Promise.resolve();
  expect(calls).toBe(1);
  scheduler.resume();
  expect(calls).toBe(1);
  finish();
  await Bun.sleep(0);
  expect(delay).toBe(UPDATE_INTERVAL);
  now += UPDATE_INTERVAL - 1;
  scheduler.resume();
  expect(calls).toBe(1);
  now++;
  scheduler.resume();
  await Promise.resolve();
  expect(calls).toBe(2);
  finish();
  await Bun.sleep(0);
  scheduler.stop();
  expect(queued).toBeUndefined();
  let attempts = 0;
  const failed = new UpdateScheduler(
    async () => {
      attempts++;
      throw Error("offline");
    },
    {
      now: () => now,
      set: (_f, ms) => {
        delay = ms;
        return 1;
      },
      clear: () => {},
    },
  );
  failed.start(0);
  await failed.resume();
  expect(attempts).toBe(1);
  expect(delay).toBe(UPDATE_INTERVAL);
  failed.stop();
});
test("legacy settings opt into automatic downloading without changing other preferences", () => {
  const { autoDownloadUpdates: _, ...old } = defaultSettings;
  expect(settingsSchema.parse(old).autoDownloadUpdates).toBe(true);
  expect(
    settingsSchema.parse({ ...old, autoDownloadUpdates: false })
      .autoDownloadUpdates,
  ).toBe(false);
});
test("a cached installer is reauthenticated on startup and stale, missing or tampered bytes are never installed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cg-pending-"));
  const path = join(dir, "setup.exe");
  const keys = generateKeyPairSync("ed25519");
  const key = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const value = {
    format: 1,
    platform: "win32",
    arch: "x64",
    version: "0.1.7",
    publishedAt: new Date().toISOString(),
    notes: "test",
    artifact: {
      file: "CineGather-0.1.7-win-x64-setup.exe",
      size: 4,
      sha512: createHash("sha512").update("test").digest("base64"),
    },
  };
  const payload = JSON.stringify(value),
    raw = JSON.stringify({
      payload,
      signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
        "base64",
      ),
    });
  const release = verifyRelease(raw, key, "win32", "x64");
  const store = new PendingUpdateStore(
    join(dir, "pending.json"),
    key,
    "win32",
    "x64",
  );
  try {
    await writeFile(path, "test");
    store.save(release, path);
    expect((await store.load("0.1.6"))?.release.version).toBe("0.1.7");
    const calls: string[] = [];
    const transport = {
      latest: async () => release,
      download: async () => {
        calls.push("restore");
      },
      install: async () => {
        calls.push("install");
      },
      cancel: () => {},
    };
    const controller = new UpdateController(
      "install",
      "0.1.6",
      transport,
      () => {},
    );
    expect(await installPendingUpdate(controller, transport, store)).toBe(true);
    expect(calls).toEqual(["restore", "install"]);
    store.save(release, path);
    await writeFile(path, "evil");
    expect(await store.load("0.1.6")).toBeUndefined();
    await writeFile(path, "test");
    store.save(release, path);
    const saved = JSON.parse(await readFile(join(dir, "pending.json"), "utf8"));
    saved.envelope = saved.envelope.replace("0.1.7", "9.9.9");
    await writeFile(join(dir, "pending.json"), JSON.stringify(saved));
    expect(await store.load("0.1.6")).toBeUndefined();
    store.save(release, path);
    expect(await store.load("0.1.7")).toBeUndefined();
    store.save(release, path);
    await rm(path);
    expect(await store.load("0.1.6")).toBeUndefined();
    await writeFile(path, "test");
    store.save(release, path);
    const serverCutoff = {
      ...transport,
      latest: async () => release,
      minimum: async () => ({ version: "0.1.8", reason: "服务器协议升级" }),
    };
    const blockedByServer = new UpdateController(
      "install",
      "0.1.6",
      serverCutoff,
      () => {},
    );
    calls.length = 0;
    expect(
      await installPendingUpdate(blockedByServer, serverCutoff, store),
    ).toBe(false);
    expect(blockedByServer.snapshot().minimumVersion).toBe("0.1.8");
    expect(calls).toEqual([]);
    store.save(release, path);
    transport.latest = async () => ({
      ...release,
      version: "0.1.8",
      minimumVersion: "0.1.8",
      artifact: {
        ...release.artifact,
        file: "CineGather-0.1.8-win-x64-setup.exe",
      },
    });
    const incompatible = new UpdateController(
      "install",
      "0.1.6",
      transport,
      () => {},
    );
    calls.length = 0;
    expect(await installPendingUpdate(incompatible, transport, store)).toBe(
      false,
    );
    expect(calls).toEqual([]);
    expect(incompatible.snapshot().required).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("automatic downloading respects opt-out, remains single-flight in rooms, and never applies to macOS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cg-auto-"));
  try {
    const calls: string[] = [];
    let finish!: () => void;
    const release = {
      format: 1 as const,
      platform: "win32" as const,
      arch: "x64" as const,
      version: "0.1.7",
      publishedAt: new Date().toISOString(),
      notes: "test",
      artifact: {
        file: "CineGather-0.1.7-win-x64-setup.exe",
        size: 4,
        sha512: createHash("sha512").update("test").digest("base64"),
      },
    };
    const transport = {
      latest: async () => release,
      download: async () => {
        calls.push("download");
        await new Promise<void>((r) => (finish = r));
      },
      install: async () => {
        calls.push("install");
      },
      cancel: () => {},
    };
    const controller = new UpdateController(
      "install",
      "0.1.6",
      transport,
      () => {},
    );
    controller.setInRoom(true);
    await controller.check();
    await automaticallyDownload(controller, false);
    expect(calls).toEqual([]);
    const pending = automaticallyDownload(controller, true);
    await Promise.resolve();
    await automaticallyDownload(controller, true);
    expect(calls).toEqual(["download"]);
    finish();
    await pending;
    expect(controller.snapshot().status).toBe("downloaded");
    const mac = new UpdateController("notify", "0.1.6", transport, () => {});
    await mac.check();
    await automaticallyDownload(mac, true);
    expect(calls).toEqual(["download"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
