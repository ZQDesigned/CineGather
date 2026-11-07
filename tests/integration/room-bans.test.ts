import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  credentials,
  users,
  rooms,
  members,
  bans,
  messages,
  friendships,
  auditLogs,
  idempotency,
} from "@cinegather/database";
import { eq, inArray, or } from "drizzle-orm";
import type { RoomInfo } from "@cinegather/contracts";
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const createdUsers: string[] = [];
async function req(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  key?: string,
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function account(name = "集成测试") {
  const r = await req("/accounts/register", undefined, {
    displayName: name,
    username: `it_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    password: "Integration account 123!",
  });
  expect(r.status).toBe(201);
  createdUsers.push(r.body.user.id);
  await db
    .update(users)
    .set({ screenShareEnabled: true })
    .where(eq(users.id, r.body.user.id));
  return { id: r.body.user.id as string, token: r.body.sessionToken as string };
}
async function room(token: string, maxMembers = 5, key?: string) {
  const r = await req(
    "/rooms",
    token,
    { name: "测试放映室", maxMembers },
    "POST",
    key,
  );
  expect(r.status).toBe(201);
  return r.body as RoomInfo;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  if (createdUsers.length)
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(inArray(messages.userId, createdUsers));
      await tx
        .delete(friendships)
        .where(
          or(
            inArray(friendships.requesterId, createdUsers),
            inArray(friendships.recipientId, createdUsers),
          ),
        );
      await tx.delete(bans).where(inArray(bans.userId, createdUsers));
      await tx.delete(members).where(inArray(members.userId, createdUsers));
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, createdUsers));
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.actorId, createdUsers));
      await tx
        .delete(idempotency)
        .where(inArray(idempotency.userId, createdUsers));
      await tx
        .delete(credentials)
        .where(inArray(credentials.userId, createdUsers));
      await tx.delete(users).where(inArray(users.id, createdUsers));
    });
  await pool.end();
});

test("room owners ban by exact account username and retain moderation permissions, audit and unban behavior", async () => {
  const owner = await account("用户名封禁房主");
  const target = await account("相同昵称");
  const other = await account("相同昵称");
  const r = await room(owner.token);
  await req(`/rooms/${r.id}/join`, target.token, {});
  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, target.id));
  const [ownerUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, owner.id));
  const path = `/rooms/${r.id}/bans`;
  expect(
    (await req(path, target.token, { username: targetUser!.username })).status,
  ).toBe(403);
  expect(
    (await req(path, target.token, { username: "unknown_account" })).status,
  ).toBe(403);
  expect(
    (
      await req(path, owner.token, {
        username: "missing_" + crypto.randomUUID().slice(0, 8),
      })
    ).status,
  ).toBe(404);
  expect(
    (await req(path, owner.token, { username: ownerUser!.username })).status,
  ).toBe(400);
  expect(
    (await req(path, owner.token, { username: "invalid username" })).status,
  ).toBe(400);
  expect(
    (
      await req(path, owner.token, {
        username: `  ${targetUser!.username!.toUpperCase()}  `,
      })
    ).status,
  ).toBe(201);
  const blocked = await req(path, owner.token);
  expect(blocked.body.items).toEqual([
    {
      userId: target.id,
      username: targetUser!.username,
      displayName: "相同昵称",
    },
  ]);
  expect((await req(`/rooms/${r.id}/join`, target.token, {})).body.code).toBe(
    "ROOM_BANNED",
  );
  expect((await req(`/rooms/${r.id}/join`, other.token, {})).status).toBe(201);
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, r.id));
  expect(
    logs.some(
      (l) =>
        l.action === "member.banned" &&
        (l.details as { userId?: string }).userId === target.id,
    ),
  ).toBe(true);
  expect(
    (await req(`${path}/${target.id}`, owner.token, undefined, "DELETE"))
      .status,
  ).toBe(200);
  expect((await req(`/rooms/${r.id}/join`, target.token, {})).status).toBe(201);
  for (const person of [target, other, owner])
    await req(`/rooms/${r.id}/leave`, person.token, {});
});
