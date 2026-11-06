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
  board: {
    revision: 1,
    elements: [],
    canUndo: false,
    canRedo: false,
    canEdit: true,
    editorIds: ["host"],
  },
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
      canEdit: true,
      editorIds: ["host"],
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

test("live previews arrive before commit, then clear on commit, permission removal and disconnect", async () => {
  const { RoomActivityClient } = await import("../src/room-activities");
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    send: (s: string) => sent.push(s),
    close: () => {},
  } as unknown as WebSocket;
  const client = new RoomActivityClient({
    origin: () => "http://localhost",
    ticket: async () => ({ ticket: "t" }),
    socket: () => socket,
  });
  client.connect("room");
  await new Promise((r) => setTimeout(r, 0));
  const receive = (m: unknown) =>
    socket.onmessage!({ data: JSON.stringify(m) } as MessageEvent);
  const snapshot = {
    ...initial,
    board: { ...initial.board!, canEdit: true, editorIds: ["host", "peer"] },
  };
  receive({ type: "snapshot", snapshot });
  const element = {
    id: "stroke",
    kind: "path",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    color: "#112233",
    strokeWidth: 3,
    points: [[1, 2]],
  };
  receive({
    type: "presence",
    presence: {
      roomId: "room",
      generation: 1,
      userId: "peer",
      name: "好友",
      cursor: { x: 1, y: 2 },
      draft: { element },
    },
  });
  expect(client.getSnapshot().presence?.[0]?.draft?.element.id).toBe("stroke");
  receive({
    type: "snapshot",
    snapshot: {
      ...snapshot,
      board: {
        ...snapshot.board,
        elements: [{ ...element, version: 2, authorId: "peer" }],
      },
    },
  });
  expect(client.getSnapshot().presence?.[0]?.draft).toBeNull();
  receive({
    type: "presence",
    presence: {
      roomId: "room",
      generation: 1,
      userId: "peer",
      name: "好友",
      cursor: { x: 3, y: 4 },
      draft: { element: { ...element, id: "second" } },
    },
  });
  receive({
    type: "snapshot",
    snapshot: {
      ...snapshot,
      board: { ...snapshot.board, editorIds: ["host"] },
    },
  });
  expect(client.getSnapshot().presence?.[0]?.draft).toBeNull();
  expect(client.getSnapshot().presence?.[0]?.cursor).toEqual({ x: 3, y: 4 });
  receive({
    type: "presence",
    presence: {
      roomId: "room",
      generation: 0,
      userId: "old",
      name: "旧活动",
      cursor: { x: 1, y: 2 },
      draft: null,
    },
  });
  expect(client.getSnapshot().presence).toHaveLength(1);
  for (let i = 0; i < 100; i++)
    client.sendPresence({ cursor: { x: i, y: i }, draft: null }, snapshot);
  expect(sent.length).toBeLessThanOrEqual(1);
  client.disconnect();
  expect(client.getSnapshot().presence).toBeUndefined();
});
