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
