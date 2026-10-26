import { expect, test } from "bun:test";
import { ShareCoordinator } from "../src/share";
function setup() {
  const events: string[] = [];
  let accept = true,
    fail = false;
  let resolve: (value: boolean) => void = () => {};
  let pending = false;
  const lease = {
    leaseId: crypto.randomUUID(),
    holderUserId: crypto.randomUUID(),
    revision: 1,
    expiresAt: new Date(Date.now() + 30000).toISOString(),
  };
  const coordinator = new ShareCoordinator({
    acquire: async () => {
      events.push("acquire");
      return lease;
    },
    renew: async (l) => l,
    release: async () => {
      events.push("release");
    },
    select: async () =>
      pending
        ? new Promise<boolean>((r) => {
            resolve = r;
          })
        : accept,
    publish: async () => {
      events.push("publish");
    },
    replace: async (l) => {
      expect(l).toEqual(lease);
      events.push("replace");
      if (fail) throw Error("source closed");
    },
    stop: async () => {
      events.push("stop");
    },
    changed() {},
    error: () => {
      events.push("error");
    },
  });
  return {
    coordinator,
    events,
    lease,
    cancel() {
      accept = false;
    },
    fail() {
      fail = true;
    },
    hold() {
      pending = true;
    },
    finish() {
      resolve(true);
    },
  };
}
test("switch preserves lease and old publication when canceled or replacement fails", async () => {
  const x = setup();
  await x.coordinator.start();
  await x.coordinator.switchSource();
  expect(x.events).toEqual(["acquire", "publish", "replace"]);
  x.fail();
  await x.coordinator.switchSource();
  expect(x.coordinator.state).toBe("active");
  expect(x.events.at(-1)).toBe("error");
  x.cancel();
  await x.coordinator.switchSource();
  expect(x.events.filter((e) => e === "replace")).toHaveLength(2);
  await x.coordinator.stop();
  expect(x.events.filter((e) => e === "release")).toHaveLength(1);
});
test("revocation during source selection forbids a late replacement", async () => {
  const x = setup();
  await x.coordinator.start();
  x.hold();
  const switching = x.coordinator.switchSource();
  await Promise.resolve();
  await x.coordinator.revoke(x.lease.leaseId);
  x.finish();
  await switching;
  expect(x.events).not.toContain("replace");
  expect(x.coordinator.state).toBe("idle");
});
