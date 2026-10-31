import { describe, expect, test } from "bun:test";
import { mobileShareCapability, MobileShare } from "../src/mobile-share";
import type { ShareLease } from "@cinegather/contracts";
const lease: ShareLease = {
  leaseId: "lease",
  holderUserId: "user",
  revision: 1,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
function setup() {
  let scope: string | undefined = "room-a";
  const calls: string[] = [];
  let finish: (() => void) | undefined;
  let blocked = false;
  let canShare = true;
  const share = new MobileShare({
    scope: () => scope,
    allowed: () => canShare,
    acquire: async (room) => {
      calls.push(`acquire:${room}`);
      return lease;
    },
    renew: async (_room, l) => l,
    release: async (room) => {
      calls.push(`release:${room}`);
    },
    publish: async (room, _lease, id) => {
      calls.push(`publish:${room}:${id}`);
      if (blocked) await new Promise<void>((r) => (finish = r));
    },
    stop: async (id) => {
      calls.push(`stop:${id}`);
    },
    changed: () => {},
    error: () => {},
  });
  return {
    share,
    calls,
    room: (v?: string) => (scope = v),
    block: () => (blocked = true),
    finish: () => finish?.(),
    allowed: (v: boolean) => (canShare = v),
  };
}
describe("mobile screen sharing", () => {
  test("distinguishes real playback capture from microphone and legacy exclusion", () => {
    expect(mobileShareCapability("android", 29)).toMatchObject({
      audio: true,
      excludesSelf: true,
      engine: "projection",
    });
    expect(mobileShareCapability("android", 28)).toMatchObject({
      audio: false,
      excludesSelf: false,
    });
    expect(mobileShareCapability("ios", 27)).toMatchObject({
      audio: true,
      excludesSelf: true,
      engine: "screencapturekit",
    });
    expect(mobileShareCapability("ios", 26)).toMatchObject({
      audio: true,
      excludesSelf: false,
      engine: "replaykit",
    });
    expect(mobileShareCapability("ios", 26).notice).toContain("映聚");
  });
  test("only connected authorized members can start", async () => {
    const t = setup();
    t.allowed(false);
    await expect(t.share.start()).rejects.toThrow("共享");
    expect(t.calls).toEqual([]);
    t.allowed(true);
    t.room();
    await expect(t.share.start()).rejects.toThrow("房间");
  });
  test("releases original room lease after room switches", async () => {
    const t = setup();
    await t.share.start();
    t.room("room-b");
    await t.share.stop();
    expect(t.calls).toContain("release:room-a");
    expect(t.calls).not.toContain("release:room-b");
  });
  test("stop during native startup prevents stale completion and duplicate starts", async () => {
    const t = setup();
    t.block();
    const first = t.share.start();
    await new Promise((r) => setTimeout(r, 0));
    await t.share.start();
    const id = t.share.captureId!;
    await t.share.stop();
    t.finish();
    await first;
    expect(t.calls.filter((c) => c.startsWith("acquire:"))).toHaveLength(1);
    expect(t.share.state).toBe("idle");
    expect(t.calls).toContain(`stop:${id}`);
  });
  test("stale native end events cannot stop a later capture", async () => {
    const t = setup();
    await t.share.start();
    const old = t.share.captureId!;
    await t.share.stop();
    await t.share.start();
    await t.share.ended(old);
    expect(t.share.state).toBe("active");
    await t.share.ended(t.share.captureId!);
    expect(t.share.state).toBe("idle");
  });
  test("room disappearing while acquiring never starts capture", async () => {
    const t = setup();
    const p = t.share.start();
    t.room();
    await p;
    expect(t.calls.some((c) => c.startsWith("publish:"))).toBe(false);
    expect(t.calls).toContain("release:room-a");
  });
});

test("cannot replace a cancelled startup scope while native shutdown is pending", async () => {
  const t = setup();
  t.block();
  const first = t.share.start();
  await new Promise((r) => setTimeout(r, 0));
  const id = t.share.captureId;
  await t.share.stop();
  t.room("room-b");
  await t.share.start();
  expect(t.share.captureId).toBe(id);
  t.finish();
  await first;
  expect(t.calls).toContain("release:room-a");
  expect(t.calls).not.toContain("release:room-b");
});

test("an old pending renewal does not block a restarted share", async () => {
  const { ShareCoordinator } = await import("../src/share");
  const ticks: (() => void)[] = [];
  let renewals = 0;
  let finish: (() => void) | undefined;
  const coordinator = new ShareCoordinator({
    acquire: async () => lease,
    release: async () => {},
    select: async () => true,
    publish: async () => {},
    stop: async () => {},
    changed: () => {},
    error: () => {},
    renew: async () => {
      renewals++;
      if (renewals === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return lease;
    },
    timers: {
      setInterval: (fn) => {
        ticks.push(fn);
        return ticks.length as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {},
    },
  });
  await coordinator.start();
  ticks[0]!();
  await coordinator.stop();
  await coordinator.start();
  ticks[1]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    expect(renewals).toBe(2);
  } finally {
    finish?.();
    await coordinator.stop();
  }
});
