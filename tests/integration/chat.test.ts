import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  credentials,
  rooms,
  auditLogs,
  messages,
  idempotency,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
import { media } from "../../apps/api/src/media";
let app: Awaited<ReturnType<typeof createApp>>, base: string;
if (
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local fixtures only");
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people: { id: string; token: string }[] = [],
  roomIds: string[] = [];
async function req(path: string, token: string, body?: unknown, key?: string) {
  const r = await fetch(`${base}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  for (let i = 0; i < 3; i++) {
    const r = await req("/accounts/register", "", {
      username: `it_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      displayName: "聊天集成验证",
      password: "Integration account 123!",
    });
    expect(r.status).toBe(201);
    people.push({ id: r.body.user.id, token: r.body.sessionToken });
  }
  for (let i = 0; i < 2; i++) {
    const r = await req("/rooms", people[0]!.token, {
      name: "聊天集成验证",
      maxMembers: 5,
    });
    expect(r.status).toBe(201);
    roomIds.push(r.body.id);
    await req(`/rooms/${r.body.id}/join`, people[0]!.token, {});
    // Keep the first room occupied when the sender switches to the second.
    if (i === 0) await req(`/rooms/${r.body.id}/join`, people[1]!.token, {});
  }
});
afterAll(async () => {
  await app?.close();
  for (const id of roomIds) await media.deleteRoom(id);
  const ids = people.map((p) => p.id);
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(idempotency).where(inArray(idempotency.userId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
});
test("chat commits before broadcast, deduplicates sends and survives a push outage", async () => {
  const original = media.chat,
    published: string[] = [];
  try {
    media.chat = async (_room, message) => {
      expect(
        await db.select().from(messages).where(eq(messages.id, message.id)),
      ).toHaveLength(1);
      published.push(message.id);
    };
    const path = `/rooms/${roomIds[0]}/messages`,
      key = crypto.randomUUID();
    const first = await req(path, people[0]!.token, { body: "实时消息" }, key);
    expect(first.status).toBe(201);
    const duplicate = await req(
      path,
      people[0]!.token,
      { body: "实时消息" },
      key,
    );
    expect(duplicate.body.id).toBe(first.body.id);
    expect(new Set(published).size).toBe(1);
    media.chat = async () => {
      throw Error("simulated SFU outage");
    };
    const saved = await req(path, people[1]!.token, { body: "断线补齐消息" });
    expect(saved.status).toBe(201);
    const replay = await req(
      `${path}?after=${first.body.id}`,
      people[0]!.token,
    );
    expect(replay.body.items.map((m: { id: string }) => m.id)).toEqual([
      saved.body.id,
    ]);
  } finally {
    media.chat = original;
  }
});
test("forward replay pages use stable ordering including equal timestamps and validate room access", async () => {
  const roomId = roomIds[1]!,
    path = `/rooms/${roomId}/messages`,
    createdAt = new Date();
  const ids = Array.from({ length: 62 }, () => crypto.randomUUID()).sort();
  await db.insert(messages).values(
    ids.map((id) => ({
      id,
      roomId,
      userId: people[0]!.id,
      body: id,
      createdAt,
    })),
  );
  const first = await req(`${path}?after=start`, people[0]!.token);
  expect(first.body.items.map((m: { id: string }) => m.id)).toEqual(
    ids.slice(0, 50),
  );
  expect(first.body.nextCursor).toBe(ids[49]);
  const next = await req(
    `${path}?after=${first.body.nextCursor}`,
    people[0]!.token,
  );
  expect(next.body.items.map((m: { id: string }) => m.id)).toEqual(
    ids.slice(50),
  );
  expect(next.body.nextCursor).toBeNull();
  const latest = await req(path, people[0]!.token);
  expect(latest.body.items.map((m: { id: string }) => m.id)).toEqual(
    ids.slice(-50),
  );
  const older = await req(
    `${path}?cursor=${latest.body.nextCursor}`,
    people[0]!.token,
  );
  expect(older.body.items.map((m: { id: string }) => m.id)).toEqual(
    ids.slice(0, 12),
  );
  expect(
    (await req(`${path}?cursor=${ids[0]}&after=${ids[1]}`, people[0]!.token))
      .status,
  ).toBe(400);
  expect((await req(`${path}?after=invalid`, people[0]!.token)).status).toBe(
    400,
  );
  expect(
    (
      await req(
        `/rooms/${roomIds[0]}/messages?after=${ids[0]}`,
        people[0]!.token,
      )
    ).status,
  ).toBe(400);
  expect((await req(path, people[2]!.token)).status).toBe(403);
  expect((await req(path, people[2]!.token, { body: "越权消息" })).status).toBe(
    403,
  );
});

test("concurrent sends remain strictly ordered behind a replay cursor", async () => {
  const original = media.chat;
  try {
    media.chat = async () => {};
    const path = `/rooms/${roomIds[0]}/messages`;
    const baseline = await req(path, people[0]!.token);
    const cursor = baseline.body.items.at(-1).id;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        req(path, people[index % 2]!.token, { body: `并发消息${index}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const replay = await req(`${path}?after=${cursor}`, people[0]!.token);
    expect(replay.body.items).toHaveLength(8);
    const dates = replay.body.items.map((m: { createdAt: string }) =>
      new Date(m.createdAt).getTime(),
    );
    expect(
      dates.every(
        (time: number, index: number) => !index || time > dates[index - 1],
      ),
    ).toBe(true);
  } finally {
    media.chat = original;
  }
});
