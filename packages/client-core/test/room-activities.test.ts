import { expect, test } from "bun:test";
import { applyActivityPatch } from "../src/room-activities";
import type { ActivitySnapshot } from "@cinegather/contracts";
const initial: ActivitySnapshot = {
  roomId: "room",
  revision: 2,
  generation: 1,
  kind: "board",
  ownerId: "host",
  requests: [],
  permissions: [],
  board: { revision: 1, elements: [], canUndo: false, canRedo: false },
};
test("board patches preserve other strokes and reject a missed base revision", () => {
  const element = {
    id: "stroke",
    kind: "path" as const,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: "#112233",
    strokeWidth: 3,
    points: [[0, 0]] as [number, number][],
    authorId: "a",
    version: 2,
  };
  const patch = {
    type: "patch" as const,
    baseRevision: 2,
    snapshot: { ...initial, revision: 3, board: undefined },
    board: {
      revision: 2,
      canUndo: false,
      canRedo: false,
      put: [element],
      remove: [],
    },
  };
  expect(applyActivityPatch(initial, patch)?.board?.elements).toEqual([
    element,
  ]);
  expect(
    applyActivityPatch({ ...initial, revision: 1 }, patch),
  ).toBeUndefined();
  expect(
    applyActivityPatch({ ...initial, roomId: "other" }, patch),
  ).toBeUndefined();
});

test("a delayed action cannot affect another room with the same generation", async () => {
  const { RoomActivityClient } = await import("../src/room-activities");
  const socket = {
    readyState: 1,
    send: () => {},
    close: () => {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  } as unknown as WebSocket;
  const client = new RoomActivityClient({
    origin: () => "http://localhost",
    ticket: async () => ({ ticket: "test" }),
    socket: () => socket,
  });
  client.connect("new-room");
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.onmessage!({
    data: JSON.stringify({
      type: "snapshot",
      snapshot: { ...initial, roomId: "new-room" },
    }),
  } as MessageEvent);
  await expect(
    client.command({ type: "end", generation: 1 }, initial),
  ).rejects.toThrow("房间活动已变化");
  expect(() =>
    client.assertContext({ ...initial, roomId: "new-room" }),
  ).not.toThrow();
  client.disconnect();
});

test("an actionable history-capacity rejection stops automatic retries", async () => {
  const { RoomActivityClient } = await import("../src/room-activities");
  const client = new RoomActivityClient({
    origin: () => "http://localhost",
    ticket: async () => {
      throw Object.assign(Error("白板记录已满"), { status: 409 });
    },
  });
  client.connect("room");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.getSnapshot()).toMatchObject({
    status: "failed",
    error: "白板记录已满",
  });
  client.disconnect();
});
