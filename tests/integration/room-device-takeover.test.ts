import { beforeAll, afterAll, test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  rooms,
  roomSessions,
  auditLogs,
} from "@cinegather/database";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>, base: string;
const ids: string[] = [];
async function req(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "X-CineGather-Platform": "android",
      "X-CineGather-Version": "0.1.26",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function account() {
  const username =
      "takeover_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    password = "Takeover test 123!";
  const a = (
    await req("/accounts/register", undefined, {
      username,
      password,
      displayName: "换设备测试",
    })
  ).body;
  ids.push(a.user.id);
  const b = (await req("/accounts/login", undefined, { username, password }))
    .body;
  return { a, b };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
});
test("the latest device takes over room admission while both account logins remain valid", async () => {
  const { a, b } = await account();
  const room = (
    await req("/rooms", a.sessionToken, { name: "设备接管", maxMembers: 5 })
  ).body;
  expect((await req(`/rooms/${room.id}/join`, a.sessionToken, {})).status).toBe(
    201,
  );
  expect((await req(`/rooms/${room.id}/join`, b.sessionToken, {})).status).toBe(
    201,
  );
  const admissions = await db
    .select()
    .from(roomSessions)
    .where(
      and(
        eq(roomSessions.userId, a.user.id),
        isNotNull(roomSessions.admittedUntil),
      ),
    );
  expect(admissions).toHaveLength(1);
  expect((await req(`/rooms/${room.id}`, a.sessionToken)).body.code).toBe(
    "ROOM_SESSION_REPLACED",
  );
  expect((await req("/me", a.sessionToken)).status).toBe(200);
  expect(
    (await req(`/rooms/${room.id}/leave`, a.sessionToken, {})).status,
  ).toBe(201);
  expect((await req(`/rooms/${room.id}`, b.sessionToken)).status).toBe(200);
});
test("invalid new-room credentials cannot evict a device already in a room", async () => {
  const { a, b } = await account(),
    owner = (await account()).a;
  const one = (
    await req("/rooms", a.sessionToken, { name: "原房间", maxMembers: 5 })
  ).body;
  const locked = (
    await req("/rooms", owner.sessionToken, {
      name: "密码房",
      maxMembers: 5,
      access: "password",
      password: "Secret 123!",
    })
  ).body;
  await req(`/rooms/${one.id}/join`, a.sessionToken, {});
  expect(
    (
      await req(`/rooms/${locked.id}/join`, b.sessionToken, {
        password: "wrong",
      })
    ).status,
  ).toBe(403);
  expect((await req(`/rooms/${one.id}`, a.sessionToken)).status).toBe(200);
});

test("concurrent joins from separate devices serialize to a single admitted session", async () => {
  const { a, b } = await account();
  const room = (
    await req("/rooms", a.sessionToken, { name: "并发接管", maxMembers: 5 })
  ).body;
  const results = await Promise.all([
    req(`/rooms/${room.id}/join`, a.sessionToken, {}),
    req(`/rooms/${room.id}/join`, b.sessionToken, {}),
  ]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(
    await db
      .select()
      .from(roomSessions)
      .where(
        and(
          eq(roomSessions.userId, a.user.id),
          isNotNull(roomSessions.admittedUntil),
        ),
      ),
  ).toHaveLength(1);
});
