import { beforeAll, afterAll, test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/context";
import {
  users,
  credentials,
  rooms,
  members,
  roomSessions,
  leases,
  auditLogs,
  roomActivities,
  whiteboardImages,
  whiteboardSnapshots,
  whiteboardRecords,
  partyWordBank,
} from "@cinegather/database";
import { inArray, eq } from "drizzle-orm";
import { protocolHeaders } from "@cinegather/contracts";
const ids: string[] = [],
  roomIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, origin: string;
async function person() {
  const id = crypto.randomUUID(),
    credentialId = crypto.randomUUID(),
    token = crypto.randomUUID();
  ids.push(id);
  await db.insert(users).values({
    id,
    username: "activity_" + id.slice(0, 8),
    displayName: "活动验证",
    passwordHash: "fixture",
    screenShareEnabled: true,
  });
  await db.insert(credentials).values({
    id: credentialId,
    userId: id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return { id, credentialId, token };
}
type Person = Awaited<ReturnType<typeof person>>;
async function fixture() {
  const host = await person(),
    guest = await person(),
    outsider = await person(),
    id = crypto.randomUUID();
  roomIds.push(id);
  await db.insert(rooms).values({
    id,
    code: id.replaceAll("-", "").slice(0, 8).toUpperCase(),
    name: "活动验证",
    ownerUserId: host.id,
    maxMembers: 5,
  });
  await db.insert(leases).values({ roomId: id });
  for (const who of [host, guest]) {
    await db.insert(members).values({
      roomId: id,
      userId: who.id,
      role: who === host ? "owner" : "member",
      admittedUntil: new Date(Date.now() + 120000),
    });
    await db.insert(roomSessions).values({
      roomId: id,
      credentialId: who.credentialId,
      userId: who.id,
      admittedUntil: new Date(Date.now() + 120000),
    });
  }
  return { id, host, guest, outsider };
}
async function call(who: Person, path: string, body?: unknown) {
  const response = await fetch(origin + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + who.token,
      "Content-Type": "application/json",
      ...protocolHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  if (roomIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, roomIds));
    const activityIds = (
      await db
        .select({ state: roomActivities.state })
        .from(roomActivities)
        .where(inArray(roomActivities.roomId, roomIds))
    ).map((r) => (r.state as { id: string }).id);
    await db
      .delete(whiteboardImages)
      .where(inArray(whiteboardImages.roomId, roomIds));
    // Each fixture can have multiple archived activities, tracked through its receipts.
    const saved = await db
      .select({ id: whiteboardRecords.snapshotId })
      .from(whiteboardRecords)
      .where(inArray(whiteboardRecords.userId, ids));
    if (saved.length)
      await db.delete(whiteboardSnapshots).where(
        inArray(
          whiteboardSnapshots.id,
          saved.map((r) => r.id),
        ),
      );
    if (activityIds.length)
      await db
        .delete(whiteboardSnapshots)
        .where(inArray(whiteboardSnapshots.activityId, activityIds));
    await db.delete(rooms).where(inArray(rooms.id, roomIds));
  }
  if (ids.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
});
test("room members collaborate; outsiders cannot read; archive is accessible to each participant", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const begun = await call(f.host, path, {
    type: "start",
    target: "board",
    generation: 0,
  });
  expect(begun.status).toBe(201);
  const generation = begun.data.generation;
  expect((await call(f.outsider, path)).status).toBe(403);
  expect((await call(f.guest, path)).status).toBe(200);
  await call(f.host, path, {
    type: "board-editor",
    generation,
    userId: f.guest.id,
    enabled: true,
  });
  const drawn = await call(f.guest, path, {
    type: "board",
    generation,
    operation: {
      type: "put",
      element: {
        id: crypto.randomUUID(),
        kind: "text",
        x: 50,
        y: 50,
        width: 200,
        height: 50,
        text: "一起画画",
        color: "#112233",
        strokeWidth: 3,
      },
    },
  });
  expect(drawn.status).toBe(201);
  expect(drawn.data.board.elements).toHaveLength(1);
  expect((await call(f.guest, path, { type: "end", generation })).status).toBe(
    403,
  );
  expect((await call(f.host, path, { type: "end", generation })).status).toBe(
    201,
  );
  for (const who of [f.host, f.guest])
    expect((await call(who, "/whiteboards")).data.items).toHaveLength(1);
  expect((await call(f.outsider, "/whiteboards")).data.items).toHaveLength(0);
});
test("approved request preserves current board until applicant confirms; permissions fence requests", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  const asked = await call(f.guest, path, {
    type: "request",
    target: "quiz",
    generation: state.generation,
  });
  expect(asked.status).toBe(201);
  const requestId = asked.data.requests[0].id;
  const approved = await call(f.host, path, {
    type: "decide",
    requestId,
    approve: true,
  });
  expect(approved.data.kind).toBe("board");
  const switched = await call(f.guest, path, {
    type: "start",
    target: "quiz",
    generation: state.generation,
    requestId,
  });
  expect(switched.data.kind).toBe("game");
  expect(
    (
      await call(f.guest, path, {
        type: "start",
        target: "board",
        generation: state.generation,
      })
    ).status,
  ).toBe(409);
  await call(f.host, path, {
    type: "permissions",
    userId: f.guest.id,
    board: false,
    game: false,
  });
  expect(
    (
      await call(f.guest, path, {
        type: "request",
        target: "board",
        generation: switched.data.generation,
      })
    ).status,
  ).toBe(403);
});

test("departed member keeps only the departure snapshot and loses live access", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  const draw = (text: string) => ({
    type: "board",
    generation: state.generation,
    operation: {
      type: "put",
      element: {
        id: crypto.randomUUID(),
        kind: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        text,
        color: "#112233",
        strokeWidth: 3,
      },
    },
  });
  await call(f.host, path, draw("离房前"));
  await db
    .delete(roomSessions)
    .where(eq(roomSessions.credentialId, f.guest.credentialId));
  expect((await call(f.guest, path)).status).toBe(403);
  await call(f.host, path, draw("离房后"));
  const history = (await call(f.guest, "/whiteboards")).data.items;
  expect(history).toHaveLength(1);
  const record = (await call(f.guest, `/whiteboards/${history[0].id}`)).data;
  expect(record.elements.map((e: { text: string }) => e.text)).toEqual([
    "离房前",
  ]);
  await call(f.host, path, { type: "end", generation: state.generation });
  expect((await call(f.host, "/whiteboards")).data.items[0].elementCount).toBe(
    2,
  );
});
test("approved request is invalidated when another credential takes over the admission", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  const requestId = (
    await call(f.guest, path, {
      type: "request",
      target: "quiz",
      generation: state.generation,
    })
  ).data.requests[0].id;
  await call(f.host, path, { type: "decide", requestId, approve: true });
  const replacement = crypto.randomUUID(),
    token = crypto.randomUUID();
  await db.insert(credentials).values({
    id: replacement,
    userId: f.guest.id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await db
    .delete(roomSessions)
    .where(eq(roomSessions.credentialId, f.guest.credentialId));
  await db.insert(roomSessions).values({
    roomId: f.id,
    userId: f.guest.id,
    credentialId: replacement,
    admittedUntil: new Date(Date.now() + 120000),
  });
  const next = { ...f.guest, token, credentialId: replacement };
  expect((await call(next, path)).data.requests).toHaveLength(0);
  expect(
    (
      await call(next, path, {
        type: "start",
        target: "quiz",
        generation: state.generation,
        requestId,
      })
    ).status,
  ).toBe(403);
});
test("image upload is private, initiator-only and old images cannot be attached to an unrelated board", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  const { Resvg } = await import("@resvg/resvg-js");
  const data =
    "data:image/png;base64," +
    Buffer.from(
      new Resvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>',
      )
        .render()
        .asPng(),
    ).toString("base64");
  expect(
    (
      await call(f.guest, path + "/images", {
        generation: state.generation,
        data,
      })
    ).status,
  ).toBe(403);
  const image = (
    await call(f.host, path + "/images", { generation: state.generation, data })
  ).data;
  expect(
    (await call(f.outsider, `/whiteboards/images/${image.id}`)).status,
  ).toBe(404);
  const element = {
    id: crypto.randomUUID(),
    imageId: image.id,
    kind: "image",
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    color: "#112233",
    strokeWidth: 3,
  };
  await call(f.host, path, {
    type: "board-editor",
    generation: state.generation,
    userId: f.guest.id,
    enabled: true,
  });
  const drawn = (
    await call(f.host, path, {
      type: "board",
      generation: state.generation,
      operation: { type: "put", element },
    })
  ).data;
  // A credential retains non-admitted rows for rooms it previously left.
  const prior = await fixture();
  const [admission] = await db
    .select()
    .from(roomSessions)
    .where(eq(roomSessions.credentialId, f.guest.credentialId));
  await db
    .delete(roomSessions)
    .where(eq(roomSessions.credentialId, f.guest.credentialId));
  await db.insert(roomSessions).values({
    roomId: prior.id,
    credentialId: f.guest.credentialId,
    userId: f.guest.id,
    admittedUntil: null,
  });
  await db.insert(roomSessions).values(admission!);
  expect((await call(f.guest, `/whiteboards/images/${image.id}`)).status).toBe(
    200,
  );
  expect(
    (
      await call(f.guest, path, {
        type: "board",
        generation: state.generation,
        operation: {
          type: "put",
          element: { ...element, x: 100 },
          expectedVersion: drawn.board.elements[0].version,
        },
      })
    ).status,
  ).toBe(201);
  await call(f.host, path, { type: "end", generation: state.generation });
  expect((await call(f.guest, `/whiteboards/images/${image.id}`)).status).toBe(
    200,
  );
  const next = (
    await call(f.host, path, {
      type: "start",
      target: "board",
      generation: state.generation + 1,
    })
  ).data;
  expect(
    (
      await call(f.host, path, {
        type: "board",
        generation: next.generation,
        operation: { type: "put", element },
      })
    ).status,
  ).toBe(403);
});
test("websocket sends board deltas and a reused command id does not undo twice", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const { WebSocket } = await import("ws");
  const ticket = (await call(f.host, path + "/ticket", {})).data.ticket;
  const socket = new WebSocket(
    origin.replace("http:", "ws:") + "/api/v1/room-activities/ws",
  );
  const queue: {
    type: string;
    snapshot: { kind: string };
    board: { put: { text: string }[] };
  }[] = [];
  socket.on("message", (raw) => queue.push(JSON.parse(raw.toString())));
  async function receive(type: string) {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      const index = queue.findIndex((m) => m.type === type);
      if (index >= 0) return queue.splice(index, 1)[0]!;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Expected WS " + type);
  }
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ ticket }));
    expect((await receive("snapshot")).snapshot.kind).toBe("idle");
    const state = (
      await call(f.host, path, {
        type: "start",
        target: "board",
        generation: 0,
      })
    ).data;
    expect((await receive("snapshot")).snapshot.kind).toBe("board");
    const element = {
      id: crypto.randomUUID(),
      kind: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      text: "增量同步",
      color: "#112233",
      strokeWidth: 3,
    };
    socket.send(
      JSON.stringify({
        id: "command-put-0001",
        command: {
          type: "board",
          generation: state.generation,
          operation: { type: "put", element },
        },
      }),
    );
    await receive("ack");
    expect((await receive("patch")).board.put[0]!.text).toBe("增量同步");
    const undo = {
      id: "command-undo-001",
      command: {
        type: "board",
        generation: state.generation,
        operation: { type: "undo" },
      },
    };
    socket.send(JSON.stringify(undo));
    await receive("ack");
    await receive("patch");
    socket.send(JSON.stringify(undo));
    await receive("ack");
    expect((await call(f.host, path)).data.board.elements).toHaveLength(0);
  } finally {
    socket.terminate();
  }
});

test("screen acquisition cannot bypass a board and consumes only the approving credential's grant", async () => {
  const { guardActivityShare } = await import(
    "../../apps/api/src/room-activities"
  );
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const begun = await call(f.host, path, {
    type: "start",
    target: "board",
    generation: 0,
  });
  const acquire = (credentialId: string) =>
    db.transaction(async (tx) => {
      await tx.select().from(rooms).where(eq(rooms.id, f.id)).for("update");
      return guardActivityShare(tx, f.id, f.host.id, credentialId);
    });
  await expect(acquire(f.host.credentialId)).rejects.toThrow();
  expect(
    (
      await call(f.host, path, {
        type: "start",
        target: "screen",
        generation: begun.data.generation,
      })
    ).status,
  ).toBe(201);
  expect((await call(f.host, path)).data.kind).toBe("board");
  await expect(acquire(f.guest.credentialId)).rejects.toThrow();
  expect(await acquire(f.host.credentialId)).toBe(true);
  expect((await call(f.guest, "/whiteboards")).data.items.length).toBe(1);
  expect(await acquire(f.host.credentialId)).toBe(false);
});

test("archive cleanup preserves receipts and image references while removing expired orphan data", async () => {
  const { cleanupWhiteboardArchives } = await import(
    "../../apps/api/src/room-activities"
  );
  const f = await fixture(),
    old = new Date(Date.now() - 172800000),
    activityId = crypto.randomUUID();
  const keep = crypto.randomUUID(),
    orphan = crypto.randomUUID(),
    keptImage = crypto.randomUUID(),
    droppedImage = crypto.randomUUID();
  await db.insert(whiteboardImages).values(
    [keptImage, droppedImage].map((id) => ({
      id,
      roomId: f.id,
      activityId,
      data: "fixture",
      createdAt: old,
    })),
  );
  await db.insert(whiteboardSnapshots).values([
    {
      id: keep,
      activityId,
      revision: 1,
      title: "kept",
      createdAt: old,
      document: {
        revision: 1,
        elements: [{ imageId: keptImage }],
        undo: [],
        redo: [],
      },
    },
    {
      id: orphan,
      activityId,
      revision: 2,
      title: "orphan",
      createdAt: old,
      document: { revision: 2, elements: [], undo: [], redo: [] },
    },
  ]);
  await db
    .insert(whiteboardRecords)
    .values({ userId: f.host.id, snapshotId: keep });
  await cleanupWhiteboardArchives(Date.now() + 7200000);
  expect(
    (
      await db
        .select()
        .from(whiteboardSnapshots)
        .where(inArray(whiteboardSnapshots.id, [keep, orphan]))
    ).map((r) => r.id),
  ).toEqual([keep]);
  expect(
    (
      await db
        .select()
        .from(whiteboardImages)
        .where(inArray(whiteboardImages.id, [keptImage, droppedImage]))
    ).map((r) => r.id),
  ).toEqual([keptImage]);
});

test("independent permission switches do not restore each other's stale values", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  await call(f.host, path, {
    type: "permissions",
    userId: f.guest.id,
    board: false,
  });
  await call(f.host, path, {
    type: "permissions",
    userId: f.guest.id,
    game: false,
  });
  const policy = (await call(f.guest, path)).data.permissions.find(
    (p: { userId: string }) => p.userId === f.guest.id,
  );
  expect(policy).toMatchObject({ board: false, game: false });
  expect(
    (await call(f.host, path, { type: "permissions", userId: f.guest.id }))
      .status,
  ).toBe(400);
});

test("switching from screen to board promptly revokes the exact publisher after commit", async () => {
  const { spyOn } = await import("bun:test");
  const { media } = await import("../../apps/api/src/media");
  const f = await fixture(),
    leaseId = crypto.randomUUID();
  await db
    .update(leases)
    .set({
      holderUserId: f.host.id,
      credentialId: f.host.credentialId,
      leaseId,
      expiresAt: new Date(Date.now() + 30000),
    })
    .where(eq(leases.roomId, f.id));
  const published: unknown[] = [];
  const control = spyOn(media, "control").mockImplementation(
    async (userId, command) => {
      const [row] = await db
        .select()
        .from(roomActivities)
        .where(eq(roomActivities.roomId, f.id));
      published.push({
        userId,
        command,
        committedKind: (row?.state as { kind: string })?.kind,
      });
    },
  );
  try {
    const path = `/rooms/${f.id}/activity`;
    const before = (await call(f.host, path)).data;
    expect(before.kind).toBe("screen");
    expect(
      (
        await call(f.host, path, {
          type: "start",
          target: "board",
          generation: before.generation,
        })
      ).status,
    ).toBe(201);
    expect(published).toContainEqual({
      userId: f.host.id,
      command: { action: "stop-share", roomId: f.id, leaseId },
      committedKind: "board",
    });
  } finally {
    control.mockRestore();
  }
});

test("whiteboard is starter-only until directly granted; revoke and switching remove editing rights", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  const edit = (generation: number) => ({
    type: "board",
    generation,
    operation: {
      type: "put",
      element: {
        id: crypto.randomUUID(),
        kind: "path",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        color: "#112233",
        strokeWidth: 3,
        points: [
          [10, 20],
          [30, 40],
        ],
      },
    },
  });
  expect((await call(f.guest, path, edit(state.generation))).status).toBe(403);
  expect((await call(f.guest, path)).data.board.canEdit).toBe(false);
  expect(
    (
      await call(f.guest, path, {
        type: "board-editor",
        generation: state.generation,
        userId: f.guest.id,
        enabled: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(f.host, path, {
        type: "board-editor",
        generation: state.generation,
        userId: f.guest.id,
        enabled: true,
      })
    ).status,
  ).toBe(201);
  expect((await call(f.guest, path)).data.board.canEdit).toBe(true);
  expect((await call(f.guest, path, edit(state.generation))).status).toBe(201);
  await call(f.host, path, {
    type: "board-editor",
    generation: state.generation,
    userId: f.guest.id,
    enabled: false,
  });
  expect(
    (
      await call(f.guest, path, {
        type: "board",
        generation: state.generation,
        operation: { type: "undo" },
      })
    ).status,
  ).toBe(403);
  expect((await call(f.guest, path, edit(state.generation))).status).toBe(403);
  await call(f.host, path, { type: "end", generation: state.generation });
  const next = (
    await call(f.guest, path, {
      type: "start",
      target: "board",
      generation: state.generation + 1,
    })
  ).data;
  expect(next.board.editorIds).toEqual([f.guest.id]);
  expect((await call(f.host, path, edit(next.generation))).status).toBe(403);
});

test("editing grants bind to the room admission and cannot survive device takeover", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  await call(f.host, path, {
    type: "board-editor",
    generation: state.generation,
    userId: f.guest.id,
    enabled: true,
  });
  const replacement = crypto.randomUUID();
  await db.insert(credentials).values({
    id: replacement,
    userId: f.guest.id,
    kind: "account",
    secretHash: hash(crypto.randomUUID()),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await db
    .update(roomSessions)
    .set({ credentialId: replacement })
    .where(eq(roomSessions.credentialId, f.guest.credentialId));
  const snapshot = (await call(f.host, path)).data;
  expect(snapshot.board.editorIds).not.toContain(f.guest.id);
});

test("live board previews stream at 20 Hz without writes, enforce permissions and clear on disconnect", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const state = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  const { WebSocket } = await import("ws");
  async function peer(who: Person) {
    const ticket = (await call(who, path + "/ticket", {})).data.ticket;
    const socket = new WebSocket(
      origin.replace("http:", "ws:") + "/api/v1/room-activities/ws",
    );
    type Frame = {
      type: string;
      board: { editorIds: string[]; canEdit: boolean };
      presence: {
        draft: { element: { id: string } } | null;
        left?: boolean;
        userId: string;
      };
    };
    const queue: Frame[] = [];
    socket.on("message", (raw) => queue.push(JSON.parse(raw.toString())));
    async function receive(predicate: (m: Frame) => boolean) {
      const end = Date.now() + 2500;
      while (Date.now() < end) {
        const i = queue.findIndex(predicate);
        if (i >= 0) return queue.splice(i, 1)[0]!;
        await Bun.sleep(10);
      }
      throw Error("Missing realtime message");
    }
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ ticket }));
    await receive((m) => m.type === "snapshot");
    return { socket, queue, receive };
  }
  const host = await peer(f.host),
    guest = await peer(f.guest);
  const element = {
    id: crypto.randomUUID(),
    kind: "path",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    color: "#112233",
    strokeWidth: 3,
    points: [
      [1, 2],
      [3, 4],
    ],
  };
  const frame = (draft: unknown) =>
    JSON.stringify({
      type: "presence",
      presence: {
        generation: state.generation,
        cursor: { x: 22, y: 44 },
        draft,
      },
    });
  try {
    guest.socket.send(frame({ element }));
    guest.socket.send(frame(null));
    expect(
      (await host.receive((m) => m.type === "presence")).presence.draft,
    ).toBeNull();
    expect(
      host.queue.filter((m) => m.type === "presence" && !!m.presence.draft),
    ).toHaveLength(0);
    for (let i = 0; i < 24; i++) {
      host.socket.send(frame({ element }));
      await Bun.sleep(50);
    }
    expect(guest.socket.readyState).toBe(WebSocket.OPEN);
    expect(host.socket.readyState).toBe(WebSocket.OPEN);
    expect(
      guest.queue.filter((m) => m.type === "presence" && !!m.presence.draft)
        .length,
    ).toBeGreaterThanOrEqual(20);
    expect((await call(f.host, path)).data.board.elements).toHaveLength(0);
    await call(f.host, path, {
      type: "board-editor",
      generation: state.generation,
      userId: f.guest.id,
      enabled: true,
    });
    await host.receive(
      (m) => m.type === "patch" && m.board.editorIds.includes(f.guest.id),
    );
    await guest.receive((m) => m.type === "patch" && m.board.canEdit);
    guest.socket.send(frame({ element }));
    expect(
      (await host.receive((m) => m.type === "presence" && !!m.presence.draft))
        .presence.draft!.element.id,
    ).toBe(element.id);
    await call(f.host, path, {
      type: "board-editor",
      generation: state.generation,
      userId: f.guest.id,
      enabled: false,
    });
    await guest.receive((m) => m.type === "patch" && !m.board.canEdit);
    await host.receive((m) => m.type === "presence" && !!m.presence.left);
    guest.socket.send(frame({ element }));
    guest.socket.send(frame(null));
    expect(
      (await host.receive((m) => m.type === "presence" && !m.presence.left))
        .presence.draft,
    ).toBeNull();
    guest.socket.close();
    expect(
      (await host.receive((m) => m.type === "presence" && !!m.presence.left))
        .presence.userId,
    ).toBe(f.guest.id);
  } finally {
    host.socket.close();
    guest.socket.close();
  }
}, 10000);

test("drag erasure is authorized, atomic and undoable across several crossed objects", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const started = (
    await call(f.host, path, { type: "start", target: "board", generation: 0 })
  ).data;
  for (let i = 0; i < 3; i++)
    await call(f.host, path, {
      type: "board",
      generation: started.generation,
      operation: {
        type: "put",
        element: {
          id: crypto.randomUUID(),
          kind: "path",
          x: i * 100,
          y: 0,
          width: 1,
          height: 1,
          color: "#112233",
          strokeWidth: 3,
          points: [
            [0, 0],
            [0, 100],
          ],
        },
      },
    });
  const elements = (await call(f.host, path)).data.board.elements.map(
    (e: { id: string; version: number }) => ({
      elementId: e.id,
      expectedVersion: e.version,
    }),
  );
  const command = {
    type: "board",
    generation: started.generation,
    operation: { type: "erase", elements },
  };
  expect((await call(f.guest, path, command)).status).toBe(403);
  expect(
    (
      await call(f.host, path, {
        ...command,
        operation: { type: "erase", elements: [...elements, elements[0]] },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(f.host, path, {
        ...command,
        operation: {
          type: "erase",
          elements: [elements[0], { ...elements[1], expectedVersion: 999 }],
        },
      })
    ).status,
  ).toBe(409);
  expect((await call(f.host, path)).data.board.elements).toHaveLength(3);
  expect((await call(f.host, path, command)).status).toBe(201);
  expect((await call(f.host, path)).data.board.elements).toHaveLength(0);
  await call(f.host, path, {
    type: "board",
    generation: started.generation,
    operation: { type: "undo" },
  });
  expect((await call(f.host, path)).data.board.elements).toHaveLength(1);
});

test("new games snapshot enabled database questions and never send the pool to members", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`,
    id = crypto.randomUUID();
  const answer = "快照验证" + id.slice(0, 8);
  await db.insert(partyWordBank).values({
    id,
    answer,
    answerKey: answer,
    category: "验证",
    clues: ["线索一", "线索二", "线索三"],
  });
  try {
    const lobby = await call(f.host, path, {
      type: "start",
      target: "quiz",
      generation: 0,
    });
    expect(lobby.status).toBe(201);
    const generation = lobby.data.generation;
    const pool = async () => {
      const [row] = await db
        .select()
        .from(roomActivities)
        .where(eq(roomActivities.roomId, f.id));
      return (row!.state as { game: { wordPool: { answer: string }[] } }).game
        .wordPool;
    };
    expect((await pool()).some((w) => w.answer === answer)).toBe(true);
    await db
      .update(partyWordBank)
      .set({ enabled: false })
      .where(eq(partyWordBank.id, id));
    for (const who of [f.host, f.guest])
      expect(
        (
          await call(who, path, {
            type: "party",
            generation,
            action: { type: "ready", ready: true },
          })
        ).status,
      ).toBe(201);
    const started = await call(f.host, path, {
      type: "party",
      generation,
      action: { type: "start" },
    });
    expect(started.status).toBe(201);
    expect(started.data.game.wordPool).toBeUndefined();
    expect((await pool()).some((w) => w.answer === answer)).toBe(false);
    const frozen = await pool();
    await db
      .update(partyWordBank)
      .set({ enabled: true, answer: answer + "新版" })
      .where(eq(partyWordBank.id, id));
    await call(f.host, path, {
      type: "party",
      generation,
      action: { type: "pause" },
    });
    expect(await pool()).toEqual(frozen);
    await call(f.host, path, { type: "end", generation });
    const idle = (await call(f.host, path)).data;
    expect(
      (
        await call(f.host, path, {
          type: "start",
          target: "draw",
          generation: idle.generation,
        })
      ).status,
    ).toBe(201);
    expect((await pool()).some((w) => w.answer === answer + "新版")).toBe(true);
  } finally {
    await db.delete(partyWordBank).where(eq(partyWordBank.id, id));
  }
});

test("drawing rerolls are private, revision guarded, and cooldown cannot be bypassed by repeated HTTP requests", async () => {
  const f = await fixture(),
    path = `/rooms/${f.id}/activity`;
  const lobby = await call(f.host, path, {
    type: "start",
    target: "draw",
    generation: 0,
  });
  expect(lobby.status).toBe(201);
  const generation = lobby.data.generation;
  const party = (who: Person, action: unknown) =>
    call(who, path, { type: "party", generation, action });
  for (const who of [f.host, f.guest])
    expect((await party(who, { type: "ready", ready: true })).status).toBe(201);
  const started = await party(f.host, { type: "start" });
  const drawer = started.data.game.drawerId === f.host.id ? f.host : f.guest;
  const other = drawer === f.host ? f.guest : f.host;
  const before = (await call(drawer, path)).data.game;
  expect(before.rerollsRemaining).toBe(3);
  expect((await party(other, { type: "reroll" })).status).toBe(409);
  const result = await party(drawer, {
    type: "reroll",
    choicesRevision: before.choicesRevision,
  });
  expect(result.status).toBe(201);
  expect(result.data.game.rerollsRemaining).toBe(2);
  expect(
    result.data.game.choices.some((w: string) => before.choices.includes(w)),
  ).toBe(false);
  expect((await party(drawer, { type: "reroll" })).status).toBe(409);
  expect(
    (
      await party(drawer, {
        type: "choose",
        index: 0,
        choicesRevision: before.choicesRevision,
      })
    ).status,
  ).toBe(409);
  const peer = (await call(other, path)).data.game;
  expect(peer.choices).toBeUndefined();
  expect(peer.rerollAvailableAt).toBeUndefined();
  const chosen = await party(drawer, {
    type: "choose",
    index: 0,
    choicesRevision: result.data.game.choicesRevision,
  });
  expect(chosen.status).toBe(201);
  expect(
    chosen.data.game.deadline - chosen.data.game.serverTime,
  ).toBeGreaterThan(89000);
  expect(
    chosen.data.game.deadline - chosen.data.game.serverTime,
  ).toBeLessThanOrEqual(90000);
});
