import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  rooms,
  members,
  friendships,
  messages,
  auditLogs,
  idempotency,
  credentials,
  bans,
} from "@cinegather/database";
import { eq, inArray, or } from "drizzle-orm";
import { media } from "../../apps/api/src/media";
import { reconcileRoom } from "../../apps/api/src/rooms";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
const ids: string[] = [];
const suffix = crypto.randomUUID().slice(0, 8);
const password = "Correct horse 123!";
async function request(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function guest(name = "临时观众") {
  const result = await request("/guests", undefined, { displayName: name });
  ids.push(result.body.user.id);
  return result.body;
}
async function register(username: string) {
  const result = await request("/accounts/register", undefined, {
    username,
    displayName: "账号观众",
    password,
  });
  expect(result.status).toBe(201);
  ids.push(result.body.user.id);
  return result.body;
}
async function create(token: string) {
  const r = await request("/rooms", token, { name: "生命周期验证" });
  expect(r.status).toBe(201);
  return r.body;
}
async function join(roomId: string, token: string) {
  expect((await request(`/rooms/${roomId}/join`, token, {})).status).toBe(201);
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  if (ids.length)
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(inArray(messages.userId, ids));
      await tx
        .delete(friendships)
        .where(
          or(
            inArray(friendships.requesterId, ids),
            inArray(friendships.recipientId, ids),
          ),
        );
      await tx.delete(bans).where(inArray(bans.userId, ids));
      await tx.delete(members).where(inArray(members.userId, ids));
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, ids));
      await tx.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
      await tx.delete(idempotency).where(inArray(idempotency.userId, ids));
      await tx.delete(credentials).where(inArray(credentials.userId, ids));
      await tx.delete(users).where(inArray(users.id, ids));
    });
  await pool.end();
});
test("accounts have normalized unique usernames, hashed secrets and stable identity across independent logins", async () => {
  const username = `Watch_${suffix}`;
  const account = await register(username);
  expect(account.user.username).toBe(username.toLowerCase());
  expect(
    (
      await request("/accounts/register", undefined, {
        username: username.toUpperCase(),
        displayName: "重复",
        password,
      })
    ).status,
  ).toBe(409);
  const login = await request("/accounts/login", undefined, {
    username: username.toUpperCase(),
    password,
  });
  expect(login.status).toBe(201);
  expect(login.body.user.id).toBe(account.user.id);
  expect(login.body.sessionToken).not.toBe(account.sessionToken);
  const [stored] = await db
    .select()
    .from(users)
    .where(eq(users.id, account.user.id));
  expect(JSON.stringify(stored)).not.toContain(password);
  const sessions = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, account.user.id));
  expect(JSON.stringify(sessions)).not.toContain(account.sessionToken);
  const wrong = await request("/accounts/login", undefined, {
    username,
    password: "wrong password",
  });
  const missing = await request("/accounts/login", undefined, {
    username: `unknown_${suffix}`,
    password,
  });
  expect(wrong.status).toBe(401);
  expect(missing.status).toBe(401);
  expect(wrong.body.message).toBe(missing.body.message);
  expect((await request("/me", account.sessionToken)).body.username).toBe(
    username.toLowerCase(),
  );
  expect(
    (await request("/session", account.sessionToken, undefined, "DELETE"))
      .status,
  ).toBe(200);
  expect((await request("/me", login.body.sessionToken)).status).toBe(200);
});
test("upgrading a guest keeps user ID and friendships; changing password revokes previous sessions", async () => {
  const legacy = await guest();
  const friend = await guest();
  await request("/friends", legacy.sessionToken, { userId: friend.user.id });
  const username = `upgrade_${suffix}`;
  const upgraded = await request("/accounts/register", legacy.sessionToken, {
    username,
    displayName: "长久的名字",
    password,
  });
  expect(upgraded.status).toBe(201);
  expect(upgraded.body.user.id).toBe(legacy.user.id);
  expect(
    (await request("/friends", upgraded.body.sessionToken)).body.items[0]
      .userId,
  ).toBe(friend.user.id);
  expect((await request("/me", legacy.sessionToken)).status).toBe(401);
  expect(
    (
      await request("/accounts/password", upgraded.body.sessionToken, {
        currentPassword: "not correct",
        password: "Brand new password 456!",
      })
    ).status,
  ).toBe(403);
  const changed = await request(
    "/accounts/password",
    upgraded.body.sessionToken,
    { currentPassword: password, password: "Brand new password 456!" },
  );
  expect(changed.status).toBe(201);
  expect((await request("/me", upgraded.body.sessionToken)).status).toBe(401);
  expect((await request("/me", changed.body.sessionToken)).status).toBe(200);
  expect(
    (await request("/accounts/login", undefined, { username, password }))
      .status,
  ).toBe(401);
  expect(
    (
      await request("/accounts/login", undefined, {
        username,
        password: "Brand new password 456!",
      })
    ).body.user.id,
  ).toBe(legacy.user.id);
});
test("invalid account inputs are rejected and repeated bad passwords are throttled", async () => {
  expect(
    (
      await request("/accounts/register", undefined, {
        username: "a",
        displayName: "x",
        password: "short",
      })
    ).status,
  ).toBe(400);
  const username = `limited_${suffix}`;
  await register(username);
  for (let i = 0; i < 8; i++)
    expect(
      (
        await request("/accounts/login", undefined, {
          username,
          password: "incorrect password",
        })
      ).status,
    ).toBe(401);
  expect(
    (await request("/accounts/login", undefined, { username, password }))
      .status,
  ).toBe(429);
});
test("departing owners transfer to present members, and the last departure destroys the room and invitations", async () => {
  const [a, b, c] = [
    await guest("房主"),
    await guest("下一任房主"),
    await guest("最后的房主"),
  ];
  const room = await create(a.sessionToken);
  await join(room.id, a.sessionToken);
  await join(room.id, b.sessionToken);
  await join(room.id, c.sessionToken);
  const invite = await request(`/rooms/${room.id}/invites`, a.sessionToken, {});
  expect(
    (await request(`/rooms/${room.id}/leave`, a.sessionToken, {})).status,
  ).toBe(201);
  expect(
    (await request(`/rooms/${room.id}`, b.sessionToken)).body,
  ).toMatchObject({ ownerUserId: b.user.id, role: "owner" });
  expect(
    (await request(`/rooms/${room.id}/invites`, a.sessionToken, {})).status,
  ).toBe(403);
  await request(`/rooms/${room.id}/leave`, b.sessionToken, {});
  expect((await request(`/rooms/${room.id}`, c.sessionToken)).body.role).toBe(
    "owner",
  );
  await request(`/rooms/${room.id}/leave`, c.sessionToken, {});
  expect((await request(`/rooms/${room.id}`, c.sessionToken)).status).toBe(404);
  expect(
    (
      await request(`/rooms/${room.code}/join`, a.sessionToken, {
        inviteToken: invite.body.token,
      })
    ).status,
  ).toBe(404);
  expect((await request("/rooms", c.sessionToken)).body.items).toHaveLength(0);
  expect(
    (await request(`/rooms/${room.id}/leave`, c.sessionToken, {})).status,
  ).toBe(201);
  expect((await media.client.listRooms([room.id])).length).toBe(0);
});
test("pending admission survives reconciliation but expired empty rooms are closed", async () => {
  const account = await guest();
  const room = await create(account.sessionToken);
  await reconcileRoom(room.id);
  expect(
    (await request(`/rooms/${room.id}`, account.sessionToken)).status,
  ).toBe(200);
  await db
    .update(members)
    .set({ admittedUntil: new Date(Date.now() - 1000) })
    .where(eq(members.roomId, room.id));
  await reconcileRoom(room.id);
  expect(
    (await request(`/rooms/${room.id}`, account.sessionToken)).status,
  ).toBe(404);
});
test("revoking the last session transfers ownership without waiting for a media webhook", async () => {
  const a = await guest();
  const b = await guest();
  const room = await create(a.sessionToken);
  await join(room.id, a.sessionToken);
  await join(room.id, b.sessionToken);
  await request("/session", a.sessionToken, undefined, "DELETE");
  expect((await request(`/rooms/${room.id}`, b.sessionToken)).body.role).toBe(
    "owner",
  );
  await request(`/rooms/${room.id}/leave`, b.sessionToken, {});
});

test("a live member is not lost when admission timestamps expire before an explicit departure", async () => {
  const a = await guest();
  const b = await guest();
  const room = await create(a.sessionToken);
  await join(room.id, a.sessionToken);
  await join(room.id, b.sessionToken);
  await db
    .update(members)
    .set({ admittedUntil: new Date(Date.now() - 1000) })
    .where(eq(members.roomId, room.id));
  const original = media.participants;
  try {
    media.participants = async () =>
      [{ identity: b.user.id }] as Awaited<ReturnType<typeof original>>;
    await request(`/rooms/${room.id}/leave`, a.sessionToken, {});
    expect((await request(`/rooms/${room.id}`, b.sessionToken)).body.role).toBe(
      "owner",
    );
  } finally {
    media.participants = original;
  }
});

test("a stranded native publisher never keeps an empty room alive", async () => {
  const a = await guest();
  const room = await create(a.sessionToken);
  await db
    .update(members)
    .set({ admittedUntil: new Date(Date.now() - 1000) })
    .where(eq(members.roomId, room.id));
  const list = media.participants,
    remove = media.remove;
  try {
    media.participants = async () =>
      [
        { identity: `cg-native:${a.user.id}:${crypto.randomUUID()}` },
      ] as Awaited<ReturnType<typeof list>>;
    media.remove = async () => {};
    await reconcileRoom(room.id);
    expect((await request(`/rooms/${room.id}`, a.sessionToken)).status).toBe(
      404,
    );
  } finally {
    media.participants = list;
    media.remove = remove;
  }
});

test("deleting a media room is idempotent even when LiveKit reports missing rooms as internal errors", async () => {
  const missing = crypto.randomUUID();
  await media.deleteRoom(missing);
  await media.deleteRoom(missing);
  expect(await media.client.listRooms([missing])).toHaveLength(0);
});

test("ownership prefers a connected human over an earlier pending admission", async () => {
  const [a, b, c] = [await guest(), await guest(), await guest()];
  const room = await create(a.sessionToken);
  await join(room.id, a.sessionToken);
  await join(room.id, b.sessionToken);
  await join(room.id, c.sessionToken);
  const list = media.participants;
  try {
    media.participants = async () =>
      [{ identity: c.user.id }] as Awaited<ReturnType<typeof list>>;
    await request(`/rooms/${room.id}/leave`, a.sessionToken, {});
    expect((await request(`/rooms/${room.id}`, c.sessionToken)).body.role).toBe(
      "owner",
    );
  } finally {
    media.participants = list;
  }
});
