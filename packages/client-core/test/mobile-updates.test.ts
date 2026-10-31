import { test, expect } from "bun:test";
import { MobileUpdater, mobileUpdateDecision } from "../src/mobile-updates";
import type { MobileUpdatePolicy } from "@cinegather/contracts";
const identity = {
  platform: "android" as const,
  channel: "stable" as const,
  runtime: "native-1",
  build: 2,
  revision: 1,
};
const policy = (minimumRevision = 0, revision = 2): MobileUpdatePolicy => ({
  format: 1,
  platform: "android",
  channel: "stable",
  policyVersion: revision,
  native: { version: "0.1.26", build: 2, minimumBuild: 0, notes: "" },
  ota: {
    runtime: "native-1",
    revision,
    minimumRevision,
    version: "0.1.27",
    updateId: `00000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
    createdAt: "2026-10-31T00:00:00.000Z",
    notes: "修复",
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function harness(p = policy()) {
  const events: string[] = [],
    stored: { value?: MobileUpdatePolicy } = {};
  const updater = new MobileUpdater({
    identity,
    enabled: true,
    latest: async () => p,
    download: async (r) => {
      events.push("download");
      return { id: r.updateId, runtime: r.runtime, revision: r.revision };
    },
    leave: async () => {
      events.push("leave");
    },
    reload: async () => {
      events.push("reload");
    },
    read: async () => stored.value,
    write: async (v) => {
      stored.value = v;
    },
    trace: () => {},
  });
  return { updater, events, stored };
}
test("normal OTA downloads in-room but never reloads until manual apply", async () => {
  const h = harness();
  await h.updater.check();
  expect(h.events).toEqual(["download"]);
  expect(h.updater.snapshot().status).toBe("ready");
  expect(h.updater.snapshot().required).toBe(false);
  await h.updater.apply();
  expect(h.events).toEqual(["download", "leave", "reload"]);
});
test("force OTA gates immediately and disconnects room before any reload", async () => {
  const h = harness(policy(2));
  await h.updater.check();
  expect(h.updater.snapshot().required).toBe(true);
  expect(h.events).toEqual(["leave", "download"]);
  await h.updater.apply();
  expect(h.events.at(-1)).toBe("reload");
  expect(h.stored.value?.ota?.minimumRevision).toBe(2);
});
test("incompatible native floor always selects full package and never fetches OTA", async () => {
  const p = policy(2);
  p.native = {
    ...p.native,
    build: 3,
    minimumBuild: 3,
    url: "https://cgplat.zqdesigned.city/downloads/mobile.apk",
  };
  const h = harness(p);
  await h.updater.check();
  expect(h.updater.snapshot().kind).toBe("package");
  expect(h.updater.snapshot().required).toBe(true);
  expect(h.events).toEqual(["leave"]);
  expect(
    mobileUpdateDecision({ ...identity, runtime: "different" }, policy(2)).kind,
  ).toBe("none");
});
test("deduplicates concurrent checks and rejects a mismatched downloaded manifest", async () => {
  const pending = deferred<MobileUpdatePolicy | undefined>();
  let requests = 0;
  const updater = new MobileUpdater({
    identity,
    enabled: true,
    latest: () => {
      requests++;
      return pending.promise;
    },
    download: async (r) => ({
      id: "wrong",
      runtime: r.runtime,
      revision: r.revision,
    }),
    leave: async () => {},
    reload: async () => {},
    read: async () => undefined,
    write: async () => {},
    trace: () => {},
  });
  const a = updater.check(),
    b = updater.check();
  pending.resolve(policy(2));
  await Promise.all([a, b]);
  expect(requests).toBe(1);
  expect(updater.snapshot().status).toBe("error");
  expect(updater.snapshot().required).toBe(true);
});
test("a persisted forced floor survives offline restart and download failure", async () => {
  const h = harness(policy(2));
  await h.updater.check();
  const updater = new MobileUpdater({
    identity,
    enabled: true,
    latest: async () => {
      throw Error("offline");
    },
    download: async () => {
      throw Error("offline");
    },
    leave: async () => {},
    reload: async () => {},
    read: async () => h.stored.value,
    write: async () => {},
    trace: () => {},
  });
  await updater.restore();
  await updater.check();
  expect(updater.snapshot().required).toBe(true);
  expect(updater.snapshot().status).toBe("error");
});
test("development mode never fetches or gates Metro sessions", async () => {
  let calls = 0;
  const updater = new MobileUpdater({
    identity,
    enabled: false,
    latest: async () => {
      calls++;
      return policy(2);
    },
    download: async () => {
      throw Error();
    },
    leave: async () => {},
    reload: async () => {},
    read: async () => policy(2),
    write: async () => {},
    trace: () => {},
  });
  await updater.restore();
  await updater.check();
  expect(calls).toBe(0);
  expect(updater.snapshot().required).toBe(false);
  expect(updater.snapshot().status).toBe("unsupported");
});
test("a newer force policy during download cannot be overwritten by the older result", async () => {
  const pending = deferred<{ id: string; runtime: string; revision: number }>();
  let downloads = 0;
  const updater = new MobileUpdater({
    identity,
    enabled: true,
    latest: async () => policy(),
    download: async (r) => {
      downloads++;
      return downloads === 1
        ? pending.promise
        : { id: r.updateId, runtime: r.runtime, revision: r.revision };
    },
    leave: async () => {},
    reload: async () => {},
    read: async () => undefined,
    write: async () => {},
    trace: () => {},
  });
  const check = updater.check();
  await new Promise((r) => setTimeout(r, 0));
  await updater.accept(policy(3, 3));
  pending.resolve({
    id: policy().ota!.updateId,
    runtime: "native-1",
    revision: 2,
  });
  await check;
  expect(updater.snapshot().policy?.ota?.revision).toBe(3);
  expect(updater.snapshot().required).toBe(true);
  expect(updater.snapshot().status).toBe("ready");
  expect(downloads).toBe(2);
});

test("an API-required update cannot be cleared by a stale optional policy", async () => {
  const h = harness();
  h.updater.require("hot");
  await h.updater.check();
  expect(h.updater.snapshot().required).toBe(true);
  expect(h.updater.snapshot().status).toBe("error");
  expect(h.events).not.toContain("download");
});
