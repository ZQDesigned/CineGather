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
import { eq, inArray, or, sql } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people = Array.from({ length: 4 }, (_, index) => ({
  id: randomUUID(),
  token: randomUUID(),
  displayName: `入房申请${index}`,
}));
const roomIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, base: string;
async function request(
  path: string,
  person = 0,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(base + "/api/v1" + path, {
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
    name: "申请加入加密房",
    maxMembers,
    access: "password",
    password: "request-room-password",
  });
  expect(result.status).toBe(201);
  roomIds.push(result.body.id);
  return result.body.id as string;
}
const send = (sender = 1, target = 0) =>
  request(`/friends/${people[target]!.id}/room-requests`, sender, {});
const decide = (id: string, action: "approve" | "reject", person = 0) =>
  request(`/room-requests/${id}/${action}`, person, {});
const social = async (person = 1) => (await request("/friends", person)).body;
beforeAll(async () => {
  for (const p of people) {
    await db.insert(users).values({
      id: p.id,
      username: "rq_" + p.id.replaceAll("-", "").slice(0, 20),
      passwordHash: "fixture-unused",
      displayName: p.displayName,
    });
    await db.insert(credentials).values({
      id: randomUUID(),
      userId: p.id,
      kind: "account",
      secretHash: hash(p.token),
      expiresAt: new Date(Date.now() + 3600_000),
      presenceAt: new Date(),
    });
  }
  await db.insert(friendships).values(
    [1, 3].map((i) => ({
      requesterId: people[0]!.id,
      recipientId: people[i]!.id,
      status: "accepted",
    })),
  );
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
test("a room friend handles a scoped request and approval grants passwordless joining only to its applicant", async () => {
  const id = await room();
  const sent = await send();
  expect(sent.status).toBe(201);
  expect((await send()).body.id).toBe(sent.body.id);
  expect((await social(0)).roomJoinRequests).toContainEqual(
    expect.objectContaining({
      id: sent.body.id,
      incoming: true,
      status: "pending",
      userId: people[1]!.id,
    }),
  );
  expect((await social(1)).roomJoinRequests).toContainEqual(
    expect.objectContaining({
      id: sent.body.id,
      incoming: false,
      status: "pending",
    }),
  );
  expect((await social(2)).roomJoinRequests).toEqual([]);
  expect((await decide(sent.body.id, "approve", 2)).status).toBe(404);
  expect((await decide(sent.body.id, "approve", 1)).status).toBe(404);
  expect((await decide(sent.body.id, "approve")).status).toBe(201);
  const invite = (await social()).roomInvitations.find(
    (i: { roomId: string }) => i.roomId === id,
  );
  expect(invite.requestApproved).toBe(true);
  expect(invite.requestId).toBe(sent.body.id);
  expect((await decide(sent.body.id, "approve")).status).toBe(201);
  expect((await decide(sent.body.id, "reject")).status).toBe(409);
  expect(
    (await request(`/rooms/${id}/join`, 3, { inviteToken: invite.token }))
      .status,
  ).toBe(403);
  expect(
    (await request(`/rooms/${id}/join`, 1, { inviteToken: invite.token }))
      .status,
  ).toBe(201);
});
test("rejection never creates an invitation and repeat requests are cooled down", async () => {
  await room();
  const sent = await send();
  expect(sent.status).toBe(201);
  expect((await decide(sent.body.id, "reject")).status).toBe(201);
  expect((await social()).roomJoinRequests).toContainEqual(
    expect.objectContaining({ id: sent.body.id, status: "rejected" }),
  );
  expect((await decide(sent.body.id, "approve")).status).toBe(409);
  expect((await send()).status).toBe(429);
});
test("full rooms fail at request, approval and join even if capacity changes between stages", async () => {
  const id = await room(2);
  expect(
    (
      await request(`/rooms/${id}/join`, 3, {
        password: "request-room-password",
      })
    ).status,
  ).toBe(201);
  expect(await send()).toMatchObject({
    status: 409,
    body: { code: "ROOM_FULL" },
  });
  await request(`/rooms/${id}/leave`, 3, {});
  const sent = await send();
  expect(sent.status).toBe(201);
  await request(`/rooms/${id}/join`, 3, { password: "request-room-password" });
  expect((await decide(sent.body.id, "approve")).status).toBe(409);
  await request(`/rooms/${id}/leave`, 3, {});
  expect((await decide(sent.body.id, "approve")).status).toBe(201);
  const invite = (await social()).roomInvitations.find(
    (i: { roomId: string }) => i.roomId === id,
  );
  await request(`/rooms/${id}/join`, 3, { password: "request-room-password" });
  expect(
    (await request(`/rooms/${id}/join`, 1, { inviteToken: invite.token }))
      .status,
  ).toBe(409);
});
test("nonfriends, bans, expired requests and a departed recipient cannot authorize admission", async () => {
  const id = await room();
  expect((await send(2)).status).toBe(403);
  await db.insert(bans).values({ roomId: id, userId: people[1]!.id });
  expect((await send()).status).toBe(403);
  await db.delete(bans).where(eq(bans.roomId, id));
  const sent = await send();
  expect(sent.status).toBe(201);
  await db.execute(
    sql`UPDATE room_join_requests SET expires_at = NOW() - interval '1 second' WHERE id = ${sent.body.id}`,
  );
  expect((await decide(sent.body.id, "approve")).status).toBe(410);
  await db.execute(
    sql`UPDATE room_join_requests SET expires_at = NOW() + interval '5 minutes' WHERE id = ${sent.body.id}`,
  );
  await db
    .update(members)
    .set({ admittedUntil: null })
    .where(eq(members.userId, people[0]!.id));
  expect([403, 409]).toContain((await decide(sent.body.id, "approve")).status);
});
test("concurrent requests and approvals are idempotent, and an ordinary member can decide for their own friend", async () => {
  const id = await room();
  await request(`/rooms/${id}/join`, 1, { password: "request-room-password" });
  await db.insert(friendships).values({
    requesterId: people[1]!.id,
    recipientId: people[3]!.id,
    status: "accepted",
  });
  const sent = await Promise.all([send(3, 1), send(3, 1)]);
  expect(sent.every((r) => r.status === 201)).toBe(true);
  expect(sent[0]!.body.id).toBe(sent[1]!.body.id);
  const decisions = await Promise.all([
    decide(sent[0]!.body.id, "approve", 1),
    decide(sent[0]!.body.id, "approve", 1),
  ]);
  expect(decisions.map((r) => r.status)).toEqual([201, 201]);
  const invitations = (await social(3)).roomInvitations.filter(
    (i: { roomId: string }) => i.roomId === id,
  );
  expect(invitations).toHaveLength(1);
  expect(
    (
      await request(`/rooms/${id}/join`, 3, {
        inviteToken: invitations[0].token,
      })
    ).status,
  ).toBe(201);
});
test("approval near expiry leaves time to receive and use its invitation, and retries survive later capacity changes", async () => {
  const id = await room(2);
  const sent = await send();
  expect(sent.status).toBe(201);
  await db.execute(
    sql`UPDATE room_join_requests SET expires_at = NOW() + interval '3 seconds' WHERE id = ${sent.body.id}`,
  );
  expect((await decide(sent.body.id, "approve")).status).toBe(201);
  const invite = (await social()).roomInvitations.find(
    (i: { roomId: string }) => i.roomId === id,
  );
  expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.now() + 240_000);
  await request(`/rooms/${id}/join`, 3, { password: "request-room-password" });
  expect((await decide(sent.body.id, "approve")).status).toBe(201);
});

test("an invisible room friend stays offline and direct requests cannot reveal or enter their room", async () => {
  await room();
  await db
    .update(users)
    .set({ presenceVisibility: "invisible" })
    .where(eq(users.id, people[0]!.id));
  const friend = (await social()).items.find(
    (item: { userId: string }) => item.userId === people[0]!.id,
  );
  expect(friend).toMatchObject({ online: false, room: null });
  expect(await send()).toMatchObject({
    status: 409,
    body: { code: "FRIEND_NOT_IN_ROOM" },
  });
  await db
    .update(users)
    .set({ presenceVisibility: "online" })
    .where(eq(users.id, people[0]!.id));
  expect((await send()).status).toBe(201);
});

test("removed friendships and bans invalidate already pending requests", async () => {
  const id = await room();
  const sent = await send();
  expect(sent.status).toBe(201);
  await db.insert(bans).values({ roomId: id, userId: people[1]!.id });
  expect((await decide(sent.body.id, "approve")).status).toBe(403);
  expect(
    (await social(0)).roomJoinRequests.some(
      (r: { id: string }) => r.id === sent.body.id,
    ),
  ).toBe(false);
  await db.delete(bans).where(eq(bans.roomId, id));
  await request(`/friends/${people[1]!.id}`, 0, undefined, "DELETE");
  expect((await decide(sent.body.id, "approve")).status).toBe(403);
  expect(
    (await social(0)).roomJoinRequests.some(
      (r: { id: string }) => r.id === sent.body.id,
    ),
  ).toBe(false);
});
