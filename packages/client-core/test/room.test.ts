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
  const enter = session.enter("room");
  await session.leave();
  admissions.add("room");
  resolve({
    room: {
      id: "room",
      name: "房间",
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
test("a media connection failure releases server admission and reports failed state", async () => {
  let admission = true;
  const states: string[] = [];
  const session = new RoomCoordinator({
    join: async () => ({
      room: {
        id: "room",
        name: "房间",
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
