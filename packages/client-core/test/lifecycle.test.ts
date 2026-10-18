import { expect, test } from "bun:test";
import { ShareCoordinator, type ShareDependencies } from "../src/share";
function harness() {
  const releases: string[] = [];
  const stops: number[] = [];
  let active = 0;
  let choose!: (value: boolean) => void;
  const deps: ShareDependencies = {
    acquire: async () => ({
      leaseId: "lease-one",
      holderUserId: "user",
      revision: 1,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }),
    renew: async (lease) => lease,
    release: async (lease) => {
      releases.push(lease.leaseId);
    },
    select: () =>
      new Promise<boolean>((resolve) => {
        choose = resolve;
      }),
    publish: async () => {
      active++;
    },
    stop: async () => {
      active = 0;
      stops.push(1);
    },
    changed: () => {},
    error: () => {},
  };
  return {
    deps,
    releases,
    stops,
    choose: (v: boolean) => choose(v),
    active: () => active,
  };
}
test("cancel during source selection releases the acquired lease and never publishes stale tracks", async () => {
  const h = harness();
  const share = new ShareCoordinator(h.deps);
  const start = share.start();
  await Promise.resolve();
  await Promise.resolve();
  await share.stop();
  h.choose(true);
  await start;
  expect(h.active()).toBe(0);
  expect(h.releases).toEqual(["lease-one"]);
  expect(share.state).toBe("idle");
});
test("declining source selection returns to idle and releases server authority", async () => {
  const h = harness();
  const share = new ShareCoordinator(h.deps);
  const start = share.start();
  await Promise.resolve();
  await Promise.resolve();
  h.choose(false);
  await start;
  expect(h.active()).toBe(0);
  expect(h.releases).toEqual(["lease-one"]);
  expect(share.state).toBe("idle");
});
test("a publishing failure stops partial media and releases the lease", async () => {
  const h = harness();
  h.deps.select = async () => true;
  h.deps.publish = async () => {
    throw new Error("denied");
  };
  const share = new ShareCoordinator(h.deps);
  await share.start();
  expect(h.stops.length).toBeGreaterThan(0);
  expect(h.releases).toEqual(["lease-one"]);
  expect(share.state).toBe("failed");
});
