import { test, expect } from "bun:test";
import { RoomCoordinator } from "../src/room";
import type { RoomInfo } from "@cinegather/contracts";
const room = (id: string): RoomInfo => ({
  id,
  name: id,
  code: "ABCDEF12",
  ownerUserId: "owner",
  role: "member",
  maxMembers: 5,
  access: "normal",
});
test("a denied feature preflight preserves the current room and never disconnects or stops its share", async () => {
  let denied = false,
    disconnects = 0,
    stops = 0;
  const joined: string[] = [],
    left: string[] = [],
    errors: unknown[] = [];
  const c = new RoomCoordinator({
    preflight: async () => {
      if (denied) throw Error("feature requires update");
    },
    join: async (id) => {
      joined.push(id);
      return { room: room(id), url: "ws://fixture", token: "fixture" };
    },
    leave: async (id) => {
      left.push(id);
    },
    connect: async () => {},
    disconnect: async () => {
      disconnects++;
    },
    stopShare: async () => {
      stops++;
    },
    changed: () => {},
    error: (e) => errors.push(e),
  });
  await c.enter("old");
  denied = true;
  await c.enter("new");
  expect(joined).toEqual(["old"]);
  expect(left).toEqual([]);
  expect(disconnects).toBe(0);
  expect(stops).toBe(0);
  expect(errors).toHaveLength(1);
  await c.leave();
  expect(left).toEqual(["old"]);
});
test("logout cancels an in-flight preflight so it cannot enter a room afterwards", async () => {
  let resolve!: () => void,
    joined = 0;
  const wait = new Promise<void>((r) => (resolve = r));
  const c = new RoomCoordinator({
    preflight: () => wait,
    join: async (id) => {
      joined++;
      return { room: room(id), url: "ws://fixture", token: "fixture" };
    },
    leave: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    stopShare: async () => {},
    changed: () => {},
    error: () => {},
  });
  const pending = c.enter("new");
  await c.leave();
  resolve();
  await pending;
  expect(joined).toBe(0);
});
