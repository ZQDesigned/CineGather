import { expect, test } from "bun:test";
import { GameLinkCoordinator } from "../src/game-link";
import type { GameSnapshot, GameTunnelConfig } from "@cinegather/contracts";
const empty: GameSnapshot = {
  session: null,
  self: null,
  members: [],
  requests: [],
  invitations: [],
};
test("selected Stardew is probed and created without inventing a Minecraft game version", async () => {
  let selected: unknown, created: unknown;
  const c = new GameLinkCoordinator({
    api: {
      snapshot: async () => empty,
      create: async (input) => {
        created = input;
        return empty;
      },
      ready: async () => empty,
      renew: async () => empty,
      transport: async () => ({}) as GameTunnelConfig,
      leave: async () => empty,
    },
    local: {
      probe: async (port, game) => {
        selected = game;
        return {
          game: "stardew-valley",
          port,
          name: "农场",
          version: "",
          transport: "tcp-udp",
        };
      },
      configure: async () => ({ state: "connected" }),
      stop: async () => {},
    },
    changed: () => {},
  });
  await c.scope("current");
  await c.create("一起种田", 24642, "stardew-valley");
  expect(selected).toBe("stardew-valley");
  expect(created).toEqual({ name: "一起种田", game: "stardew-valley" });
});
const snapshot = (): GameSnapshot => ({
  session: {
    id: crypto.randomUUID(),
    code: "ABCDEFGH",
    name: "测试联机",
    game: "minecraft-java",
    hostUserId: crypto.randomUUID(),
    hostName: "好友",
    status: "open",
    maxMembers: 8,
    memberCount: 2,
    gameVersion: null,
    createdAt: new Date().toISOString(),
  },
  self: {
    memberId: crypto.randomUUID(),
    role: "guest",
    revision: 1,
    leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
  },
  members: [],
  requests: [],
  invitations: [],
});
function fixture() {
  let value = empty,
    stop = 0,
    configure = 0,
    leave = 0,
    renew = 0;
  const coordinator = new GameLinkCoordinator({
    api: {
      snapshot: async () => value,
      create: async () => value,
      ready: async () => value,
      renew: async () => {
        renew++;
        return value;
      },
      transport: async () => ({}) as GameTunnelConfig,
      leave: async () => {
        leave++;
        value = empty;
        return value;
      },
    },
    local: {
      probe: async (port) => ({
        port,
        name: "本机世界",
        version: "1.21",
        protocol: 1,
      }),
      configure: async () => {
        configure++;
        return { state: "connected", address: "127.0.0.1:25566" };
      },
      stop: async () => {
        stop++;
      },
    },
    changed: () => {},
  });
  return {
    coordinator,
    set: (s: GameSnapshot) => {
      value = s;
    },
    counts: () => ({ stop, configure, leave, renew }),
  };
}
test("approved game admission connects independently and closing it never touches a voice coordinator", async () => {
  const f = fixture();
  await f.coordinator.scope("account-token");
  f.set(snapshot());
  await f.coordinator.refresh();
  expect(f.counts().configure).toBe(1);
  expect(f.coordinator.state.local.address).toBe("127.0.0.1:25566");
  await f.coordinator.exit();
  expect(f.counts().leave).toBe(1);
  expect(f.coordinator.state.snapshot.session).toBeNull();
});
test("a response from an old login cannot start a game after logout", async () => {
  let resolve!: (s: GameSnapshot) => void;
  let started = 0;
  let began!: () => void;
  const startedRequest = new Promise<void>((r) => {
    began = r;
  });
  const f = fixture(),
    coordinator = new GameLinkCoordinator({
      api: {
        snapshot: () =>
          new Promise((r) => {
            resolve = r;
            began();
          }),
        create: async () => empty,
        ready: async () => empty,
        renew: async () => empty,
        transport: async () => ({}) as GameTunnelConfig,
        leave: async () => empty,
      },
      local: {
        probe: async () => ({
          port: 123,
          name: "x",
          version: "x",
          protocol: 1,
        }),
        configure: async () => {
          started++;
          return { state: "connected" };
        },
        stop: async () => {},
      },
      changed: () => {},
    });
  await coordinator.scope("old");
  const refresh = coordinator.refresh();
  await startedRequest;
  await coordinator.scope(undefined);
  resolve(snapshot());
  await refresh;
  expect(started).toBe(0);
  expect(coordinator.state.snapshot.session).toBeNull();
  await f.coordinator.scope(undefined);
});
test("another device membership is visible without starting a proxy and host recovery needs an explicit local world", async () => {
  const f = fixture();
  await f.coordinator.scope("token");
  const other = { ...snapshot(), self: null };
  f.set(other);
  await f.coordinator.refresh();
  expect(f.counts().configure).toBe(0);
  const host = snapshot();
  host.self!.role = "host";
  f.set(host);
  await f.coordinator.refresh();
  expect(f.counts().configure).toBe(0);
  expect(f.coordinator.state.local.message).toContain("选择");
  await f.coordinator.resumeHost(25565);
  expect(f.counts().configure).toBe(1);
  await f.coordinator.scope(undefined);
});

test("an interrupted native connection replaces stale connected status without mislabeling a healthy connection during API failure", async () => {
  let failed = false;
  const value = snapshot(),
    coordinator = new GameLinkCoordinator({
      api: {
        snapshot: async () => value,
        create: async () => value,
        ready: async () => value,
        renew: async () => value,
        transport: async () => ({}) as GameTunnelConfig,
        leave: async () => empty,
      },
      local: {
        probe: async () => ({
          port: 123,
          name: "x",
          version: "x",
          protocol: 1,
        }),
        configure: async () => {
          if (failed) throw Error("native exited");
          return { state: "connected", address: "127.0.0.1:25566" };
        },
        status: async () => ({ state: failed ? "failed" : "connected" }),
        stop: async () => {},
      },
      changed: () => {},
    });
  await coordinator.scope("test");
  await coordinator.refresh();
  expect(coordinator.state.local.state).toBe("connected");
  failed = true;
  await coordinator.refresh();
  expect(coordinator.state.local.state).toBe("failed");
  await coordinator.scope(undefined);
});

for (const role of ["host", "guest"] as const)
  test(`${role} exit excludes concurrent polling until leave completes`, async () => {
    const joined = snapshot();
    joined.self!.role = role;
    let releaseLeave!: () => void;
    let leaveStarted!: () => void;
    let releaseSnapshot: ((value: GameSnapshot) => void) | undefined;
    let delaySnapshot = false;
    let configured = 0;
    const began = new Promise<void>((resolve) => {
      leaveStarted = resolve;
    });
    const pendingLeave = new Promise<void>((resolve) => {
      releaseLeave = resolve;
    });
    const coordinator = new GameLinkCoordinator({
      api: {
        snapshot: () =>
          delaySnapshot
            ? new Promise((resolve) => {
                releaseSnapshot = resolve;
              })
            : Promise.resolve(joined),
        create: async () => joined,
        ready: async () => joined,
        renew: async () => joined,
        transport: async () =>
          ({
            memberId: joined.self!.memberId,
            revision: 1,
          }) as GameTunnelConfig,
        leave: async () => {
          leaveStarted();
          await pendingLeave;
          return empty;
        },
      },
      local: {
        probe: async (port) => ({
          port,
          name: "world",
          version: "1.21",
          protocol: 1,
        }),
        configure: async () => {
          configured++;
          return { state: "connected" };
        },
        stop: async () => {},
      },
      changed: () => {},
    });
    await coordinator.scope("test");
    if (role === "host") await coordinator.create("test", 25565);
    else await coordinator.refresh();
    const before = configured;
    const leaving = coordinator.exit();
    await began;
    delaySnapshot = true;
    const polling = coordinator.refresh();
    await Promise.resolve();
    await Promise.resolve();
    releaseLeave();
    await leaving;
    // A delayed snapshot taken during exit must never reconnect the ended game.
    releaseSnapshot?.(joined);
    await polling;
    expect(coordinator.state.snapshot.session).toBeNull();
    expect(coordinator.state.local.state).toBe("idle");
    expect(configured).toBe(before);
  });

test("a created host session survives local connection failure as a recoverable state, not a failed create action", async () => {
  const value = snapshot();
  value.self!.role = "host";
  value.session!.status = "starting";
  const errors: (string | undefined)[] = [];
  const c = new GameLinkCoordinator({
    api: {
      snapshot: async () => value,
      create: async () => value,
      renew: async () => value,
      ready: async () => value,
      transport: async () =>
        ({ memberId: value.self!.memberId, revision: 1 }) as GameTunnelConfig,
      leave: async () => empty,
    },
    local: {
      probe: async (port) => ({
        port,
        name: "MC",
        version: "1.21",
        protocol: 1,
      }),
      configure: async () => {
        throw Error("configuration rejected");
      },
      status: async () => ({ state: "failed", message: "本机连接失败" }),
      stop: async () => {},
    },
    changed: (s) => errors.push(s.error),
  });
  await c.scope("test");
  await c.create("MC", 25565);
  expect(c.state.snapshot.session?.id).toBe(value.session!.id);
  expect(c.state.local.state).toBe("failed");
  expect(c.state.error).toBeTruthy();
  errors.length = 0;
  await c.refresh();
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.every(Boolean)).toBe(true);
});

test("a closed host world suspends automatic reconnect and preserves an explicit recovery hint", async () => {
  const value = snapshot();
  value.self!.role = "host";
  let closed = false,
    renews = 0,
    attempts = 0;
  const c = new GameLinkCoordinator({
    api: {
      snapshot: async () => value,
      create: async () => value,
      renew: async () => {
        renews++;
        return value;
      },
      ready: async () => value,
      transport: async () =>
        ({ memberId: value.self!.memberId, revision: 1 }) as GameTunnelConfig,
      leave: async () => empty,
    },
    local: {
      probe: async (port) => ({
        port,
        name: "MC",
        version: "1.21",
        protocol: 1,
      }),
      configure: async () => {
        attempts++;
        if (closed) throw Error("world closed");
        return { state: "connected" };
      },
      status: async () => ({
        state: "failed",
        reason: "world-unavailable",
        message: "局域网共享已停止，请重新开放世界后恢复联机",
      }),
      stop: async () => {},
    },
    changed: () => {},
  });
  await c.scope("test");
  await c.create("MC", 25565);
  closed = true;
  await c.refresh();
  const before = { renews, attempts };
  await c.refresh();
  await c.refresh();
  expect({ renews, attempts }).toEqual(before);
  expect(c.state.local).toMatchObject({
    state: "failed",
    reason: "world-unavailable",
  });
  closed = false;
  await c.resumeHost(25565);
  expect(c.state.local.state).toBe("connected");
  expect(c.state.error).toBeUndefined();
});
