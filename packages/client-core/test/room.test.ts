import { test, expect } from "bun:test";
import { RoomCoordinator, type RoomDependencies } from "../src/room";
test("leaving while join is pending cannot connect a stale room or retain its admission", async () => {
  let resolve!: (result: Awaited<ReturnType<RoomDependencies["join"]>>) => void;
  let connected = false;
  const admissions = new Set<string>();
  const states: string[] = [];
  const revisions: number[] = [];
  const deps: RoomDependencies = {
    join: () =>
      new Promise((r) => {
        resolve = r;
      }),
    leave: async (id) => {
      admissions.delete(id);
    },
    connect: async () => {
      connected = true;
    },
    disconnect: async () => {
      connected = false;
    },
    stopShare: async () => {},
    changed: (state, _room, revision) => {
      states.push(state);
      revisions.push(revision);
    },
    error: () => {},
  };
  const session = new RoomCoordinator(deps);
  const enter = session.enter("1234ABCD");
  await session.leave();
  admissions.add("room");
  resolve({
    room: {
      id: "room",
      name: "房间",
      code: "1234ABCD",
      access: "normal",
      ownerUserId: "owner",
      maxMembers: 5,
      role: "member",
    },
    token: "jwt",
    url: "ws://local",
  });
  await enter;
  expect(connected).toBe(false);
  expect(admissions.size).toBe(0);
  expect(states.at(-1)).toBe("idle");
  expect(revisions.at(-1)!).toBeGreaterThan(revisions[0]!);
});
test("password retries use the canonical room ID and keep credentials only until leaving", async () => {
  const joins: unknown[][] = [];
  const leaves: string[] = [];
  const session = new RoomCoordinator({
    join: async (...args) => {
      joins.push(args);
      return {
        room: {
          id: "canonical",
          code: "1234ABCD",
          access: "password",
          name: "加密房",
          ownerUserId: "owner",
          maxMembers: 5,
          role: "member",
        },
        token: "jwt",
        url: "ws://local",
      };
    },
    connect: async () => {},
    disconnect: async () => {},
    stopShare: async () => {},
    leave: async (id) => {
      leaves.push(id);
    },
    changed: () => {},
    error: () => {},
  });
  await session.enter("1234ABCD", undefined, "pass123");
  await session.retry();
  expect(joins).toEqual([
    ["1234ABCD", undefined, "pass123"],
    ["canonical", undefined, "pass123"],
  ]);
  expect(leaves).toEqual(["canonical"]);
  await session.leave();
  await session.retry();
  expect(joins).toHaveLength(2);
});
test("failed password admission does not release a room that never admitted this client", async () => {
  let leaves = 0;
  const states: string[] = [];
  const session = new RoomCoordinator({
    join: async () => {
      throw new Error("wrong password");
    },
    connect: async () => {},
    disconnect: async () => {},
    stopShare: async () => {},
    leave: async () => {
      leaves++;
    },
    changed: (state) => {
      states.push(state);
    },
    error: () => {},
  });
  await session.enter("1234ABCD", undefined, "wrong");
  expect(leaves).toBe(0);
  expect(states.at(-1)).toBe("failed");
});
test("remote eviction clears local media and retry credentials without an unauthorized leave request", async () => {
  let leaves = 0;
  let joins = 0;
  let stops = 0;
  let disconnects = 0;
  const states: string[] = [];
  const session = new RoomCoordinator({
    join: async () => {
      joins++;
      return {
        room: {
          id: "canonical",
          code: "1234ABCD",
          access: "password",
          name: "加密房",
          ownerUserId: "owner",
          maxMembers: 5,
          role: "member",
        },
        token: "jwt",
        url: "ws://local",
      };
    },
    connect: async () => {},
    disconnect: async () => {
      disconnects++;
    },
    stopShare: async () => {
      stops++;
    },
    leave: async () => {
      leaves++;
    },
    changed: (state) => {
      states.push(state);
    },
    error: () => {},
  });
  await session.enter("1234ABCD", undefined, "password");
  await session.leave(false);
  await session.retry();
  expect(leaves).toBe(0);
  expect(joins).toBe(1);
  expect(stops).toBe(1);
  expect(disconnects).toBe(1);
  expect(states.at(-1)).toBe("idle");
});
test("a media failure can retry an admitted password room without asking for the password again", async () => {
  const attempts: unknown[][] = [];
  const states: string[] = [];
  let connects = 0;
  const session = new RoomCoordinator({
    join: async (...args) => {
      attempts.push(args);
      return {
        room: {
          id: "canonical",
          code: "1234ABCD",
          access: "password",
          name: "加密房",
          ownerUserId: "owner",
          maxMembers: 5,
          role: "member",
        },
        token: "jwt",
        url: "ws://local",
      };
    },
    connect: async () => {
      if (++connects === 1) throw new Error("ICE failed");
    },
    disconnect: async () => {},
    stopShare: async () => {},
    leave: async () => {},
    changed: (state) => {
      states.push(state);
    },
    error: () => {},
  });
  await session.enter("1234ABCD", undefined, "password");
  expect(states.at(-1)).toBe("failed");
  await session.retry();
  expect(attempts.at(-1)).toEqual(["canonical", undefined, "password"]);
  expect(states.at(-1)).toBe("connected");
  await session.leave();
  await session.retry();
  expect(attempts).toHaveLength(2);
});
test("a media connection failure releases server admission and reports failed state", async () => {
  let admission = true;
  const states: string[] = [];
  const session = new RoomCoordinator({
    join: async () => ({
      room: {
        id: "room",
        name: "房间",
        code: "1234ABCD",
        access: "normal",
        ownerUserId: "owner",
        maxMembers: 5,
        role: "owner",
      },
      token: "jwt",
      url: "ws://local",
    }),
    connect: async () => {
      throw new Error("ICE failed");
    },
    disconnect: async () => {},
    leave: async () => {
      admission = false;
    },
    stopShare: async () => {},
    changed: (s) => {
      states.push(s);
    },
    error: () => {},
  });
  await session.enter("room");
  expect(admission).toBe(false);
  expect(states.at(-1)).toBe("failed");
});
test("leaving disconnects the microphone before waiting for a pending screen picker to stop", async () => {
  let resolveStop!: () => void;
  let disconnected = false;
  const stopping = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const session = new RoomCoordinator({
    join: async () => ({
      room: {
        id: "room",
        name: "房间",
        code: "1234ABCD",
        access: "normal",
        ownerUserId: "owner",
        maxMembers: 5,
        role: "owner",
      },
      token: "jwt",
      url: "ws://local",
    }),
    connect: async () => {},
    disconnect: async () => {
      disconnected = true;
    },
    stopShare: () => stopping,
    leave: async () => {},
    changed: () => {},
    error: () => {},
  });
  await session.enter("room");
  const leave = session.leave();
  await Promise.resolve();
  await Promise.resolve();
  const microphoneReleased = disconnected;
  resolveStop();
  await leave;
  expect(microphoneReleased).toBe(true);
});
