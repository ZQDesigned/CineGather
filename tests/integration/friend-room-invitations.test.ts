import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { hash } from "../../apps/api/src/context";
import {
  createDatabase,
  users,
  credentials,
  friendships,
  rooms,
  invites,
  members,
  bans,
  auditLogs,
  leases,
} from "@cinegather/database";
import { eq, inArray, or } from "drizzle-orm";

const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people = Array.from({ length: 4 }, (_, index) => ({
  id: randomUUID(),
  token: randomUUID(),
  displayName: `邀请测试${index}`,
}));
const roomIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, base: string;
async function request(
  path: string,
  person = 0,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${people[person]!.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function room(maxMembers = 5) {
  const result = await request("/rooms", 0, {
    name: "好友邀请验证",
    maxMembers,
    access: "password",
    password: "test-room-password",
  });
  expect(result.status).toBe(201);
  roomIds.push(result.body.id);
  return result.body.id as string;
}
const send = (roomId: string, sender = 0, recipient = 1) =>
  request(`/rooms/${roomId}/friend-invitations`, sender, {
    userId: people[recipient]!.id,
  });
const inbox = async (person = 1) =>
  (await request("/friends", person)).body.roomInvitations as {
    id: string;
    roomId: string;
    token: string;
    senderName: string;
  }[];
beforeAll(async () => {
  for (const person of people) {
    await db.insert(users).values({
      id: person.id,
      username: "inv_" + person.id.replaceAll("-", "").slice(0, 20),
      passwordHash: "fixture-unused",
      displayName: person.displayName,
    });
    await db.insert(credentials).values({
      id: randomUUID(),
      userId: person.id,
      kind: "account",
      secretHash: hash(person.token),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }
  await db.insert(friendships).values([
    {
      requesterId: people[0]!.id,
      recipientId: people[1]!.id,
      status: "accepted",
    },
    {
      requesterId: people[1]!.id,
      recipientId: people[3]!.id,
      status: "accepted",
    },
  ]);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  const ids = people.map((p) => p.id);
  if (roomIds.length) {
    await db.delete(invites).where(inArray(invites.roomId, roomIds));
    await db.delete(bans).where(inArray(bans.roomId, roomIds));
    await db.delete(leases).where(inArray(leases.roomId, roomIds));
    await db.delete(members).where(inArray(members.roomId, roomIds));
    await db.delete(rooms).where(inArray(rooms.id, roomIds));
  }
  await db
    .delete(friendships)
    .where(
      or(
        inArray(friendships.requesterId, ids),
        inArray(friendships.recipientId, ids),
      ),
    );
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});

test("only active room members can invite accepted friends and only the recipient receives the invitation", async () => {
  const id = await room();
  expect((await send(id, 0, 2)).status).toBe(403);
  expect((await send(id, 2, 1)).status).toBe(403);
  expect((await send(id, 0, 0)).status).toBe(400);
  const sent = await send(id);
  expect(sent.status).toBe(201);
  expect(sent.body).not.toHaveProperty("token");
  const received = (await inbox()).find((i) => i.id === sent.body.id)!;
  expect(received).toMatchObject({
    roomId: id,
    senderName: people[0]!.displayName,
  });
  expect(received.token).toHaveLength(64);
  expect(await inbox(2)).toEqual([]);
  expect(
    (await request(`/rooms/${id}/join`, 2, { inviteToken: received.token }))
      .status,
  ).toBe(403);
  expect(
    (await request(`/rooms/${id}/join`, 1, { inviteToken: received.token }))
      .status,
  ).toBe(201);
  expect((await inbox()).some((i) => i.id === sent.body.id)).toBe(false);
  expect((await send(id, 1, 3)).status).toBe(201);
});

test("pending invitations are idempotent, recipient dismissal is scoped and repeated sends are rate limited", async () => {
  const id = await room();
  const first = await send(id),
    second = await send(id);
  expect(second.body.id).toBe(first.body.id);
  expect(
    (
      await request(
        `/room-invitations/${first.body.id}`,
        2,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/room-invitations/${first.body.id}`,
        1,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect((await inbox()).some((i) => i.id === first.body.id)).toBe(false);
  expect((await send(id)).status).toBe(429);
});

test("invited users still obey room capacity and bans and unsuccessful joins do not consume the invitation", async () => {
  const id = await room(2),
    sent = await send(id);
  const invite = (await inbox()).find((i) => i.id === sent.body.id)!;
  expect(
    (await request(`/rooms/${id}/join`, 3, { password: "test-room-password" }))
      .status,
  ).toBe(201);
  expect(
    (await request(`/rooms/${id}/join`, 1, { inviteToken: invite.token }))
      .status,
  ).toBe(409);
  expect((await inbox()).some((i) => i.id === invite.id)).toBe(true);
  await db.insert(bans).values({ roomId: id, userId: people[1]!.id });
  expect(
    (await request(`/rooms/${id}/join`, 1, { inviteToken: invite.token }))
      .status,
  ).toBe(403);
});

test("revoked, expired, closed-room and no-longer-friends invitations cannot admit a user", async () => {
  for (const kind of [
    "revoked",
    "expired",
    "closed",
    "disabled",
    "unfriend",
  ] as const) {
    const id = await room(),
      sent = await send(id);
    const invite = (await inbox()).find((i) => i.id === sent.body.id)!;
    if (kind === "revoked")
      await request(
        `/rooms/${id}/invites/${invite.id}`,
        0,
        undefined,
        "DELETE",
      );
    if (kind === "expired")
      await db
        .update(invites)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(invites.id, invite.id));
    if (kind === "closed")
      await db.update(rooms).set({ status: "closed" }).where(eq(rooms.id, id));
    if (kind === "unfriend")
      await request(`/friends/${people[1]!.id}`, 0, undefined, "DELETE");
    if (kind === "disabled")
      await db
        .update(users)
        .set({ disabledAt: new Date() })
        .where(eq(users.id, people[0]!.id));
    expect((await inbox()).some((i) => i.id === invite.id)).toBe(false);
    expect([403, 404]).toContain(
      (await request(`/rooms/${id}/join`, 1, { inviteToken: invite.token }))
        .status,
    );
    if (kind === "disabled")
      await db
        .update(users)
        .set({ disabledAt: null })
        .where(eq(users.id, people[0]!.id));
  }
});
