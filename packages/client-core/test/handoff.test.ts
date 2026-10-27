import { test, expect } from "bun:test";
import { ShareCoordinator } from "../src/share";
const lease = {
  leaseId: "00000000-0000-4000-8000-000000000001",
  holderUserId: "00000000-0000-4000-8000-000000000002",
  revision: 2,
  expiresAt: new Date(Date.now() + 30000).toISOString(),
};
function setup(select: () => Promise<boolean>) {
  const calls: string[] = [];
  const coordinator = new ShareCoordinator({
    acquire: async () => {
      calls.push("normal");
      return lease;
    },
    renew: async (l) => l,
    release: async () => {
      calls.push("release");
    },
    select,
    publish: async () => {
      calls.push("publish");
    },
    stop: async () => {
      calls.push("stop");
    },
    changed: () => {},
    error: () => {
      calls.push("error");
    },
  });
  return {
    coordinator,
    calls,
    acquire: async () => {
      calls.push("handoff");
      return lease;
    },
  };
}
test("handoff cancellation leaves the existing publisher untouched", async () => {
  const s = setup(async () => false);
  await s.coordinator.startHandoff(s.acquire);
  expect(s.calls).not.toContain("handoff");
  expect(s.calls).not.toContain("release");
  expect(s.coordinator.state).toBe("idle");
});
test("source consent happens before transfer and publish", async () => {
  let confirm!: (v: boolean) => void;
  const s = setup(
    () =>
      new Promise((r) => {
        confirm = r;
      }),
  );
  const pending = s.coordinator.startHandoff(s.acquire);
  expect(s.coordinator.state).toBe("selectingSource");
  expect(s.calls).toEqual([]);
  confirm(true);
  await pending;
  expect(s.calls).toEqual(["handoff", "publish"]);
  expect(s.coordinator.state).toBe("active");
  await s.coordinator.stop();
});
test("stopping during the picker cannot transfer later", async () => {
  let confirm!: (v: boolean) => void;
  const s = setup(
    () =>
      new Promise((r) => {
        confirm = r;
      }),
  );
  const pending = s.coordinator.startHandoff(s.acquire);
  await s.coordinator.stop();
  confirm(true);
  await pending;
  expect(s.calls).not.toContain("handoff");
});
