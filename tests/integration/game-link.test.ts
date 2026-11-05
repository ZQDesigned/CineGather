import { beforeAll, afterAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/context";
import {
  createDatabase,
  users,
  credentials,
  gameSessions,
  gameMembers,
  auditLogs,
  rooms,
  friendships,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
import { protocolHeaders } from "@cinegather/contracts";
const { pool } = createDatabase(process.env.DATABASE_URL!);
const people: string[] = [],
  roomIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, origin: string;
async function person(host = false) {
  const id = crypto.randomUUID(),
    credentialId = crypto.randomUUID(),
    token = crypto.randomUUID();
  people.push(id);
  await db.insert(users).values({
    id,
    displayName: "游戏联机验证",
    username: "game_flow_" + id.replaceAll("-", "").slice(0, 12),
    passwordHash: "fixture",
    gameHostEnabled: host,
  });
  await db.insert(credentials).values({
    id: credentialId,
    userId: id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  });
  return { id, credentialId, token };
}
type Person = Awaited<ReturnType<typeof person>>;
async function call(
  path: string,
  who: Person,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + who.token,
      "X-CineGather-Platform": "win32",
      "X-CineGather-Version": "0.1.33",
      ...protocolHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function opened(host: Person) {
  const result = await call("/games", host, {
    game: "minecraft-java",
    name: "独立游戏联机",
  });
  expect(result.status).toBe(201);
  const id = result.data.session.id as string;
  expect((await call(`/games/${id}/ready`, host, {})).status).toBe(201);
  return id;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  const { media } = await import("../../apps/api/src/media");
  for (const id of roomIds) await media.deleteRoom(id);
  if (people.length) {
    const owned = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(inArray(gameSessions.hostUserId, people));
    if (owned.length)
      await db.delete(auditLogs).where(
        inArray(
          auditLogs.targetId,
          owned.map((r) => r.id),
        ),
      );
    await db
      .delete(gameSessions)
      .where(inArray(gameSessions.hostUserId, people));
    await db.delete(rooms).where(inArray(rooms.ownerUserId, people));
    await db
      .delete(friendships)
      .where(inArray(friendships.requesterId, people));
    await db
      .delete(friendships)
      .where(inArray(friendships.recipientId, people));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, people));
    await db.delete(users).where(inArray(users.id, people));
  }
  await pool.end();
});

test("game hosting is capability-gated, guest approval is not, and game admission never requires a voice room", async () => {
  const host = await person(true),
    guest = await person();
  expect((await call("/games", guest, { name: "不允许发起" })).status).toBe(
    403,
  );
  expect((await call("/me", host)).data.gameHostEnabled).toBe(true);
  const id = await opened(host);
  const snapshot = (await call("/games", host)).data;
  const found = await call("/games/lookup", guest, {
    code: snapshot.session.code,
  });
  expect(found.status).toBe(201);
  expect(found.data.members).toBeUndefined();
  const asked = await call(`/games/${id}/requests`, guest, {});
  expect(asked.status).toBe(201);
  expect((await call("/games", guest)).data.self).toBeNull();
  const approved = await call(
    `/games/requests/${asked.data.id}/decision`,
    host,
    { approve: true },
  );
  expect(approved.status).toBe(201);
  const member = (await call("/games", guest)).data;
  expect(member.self.role).toBe("guest");
  expect(member.members).toHaveLength(2);
  expect(JSON.stringify(member)).not.toMatch(
    /clientSecret|tunnelSecret|relayAddress|credentialId|roomId/,
  );
  expect(
    (
      await call(`/games/${id}/renew`, guest, {
        revision: member.self.revision,
      })
    ).status,
  ).toBe(201);
});

test("leaving voice preserves game membership and leaving a game preserves the account session", async () => {
  const host = await person(true),
    id = await opened(host);
  const room = await call("/rooms", host, {
    name: "语音与游戏独立",
    maxMembers: 5,
  });
  expect(room.status).toBe(201);
  roomIds.push(room.data.id);
  expect((await call(`/rooms/${room.data.id}/join`, host, {})).status).toBe(
    201,
  );
  expect((await call(`/rooms/${room.data.id}/leave`, host, {})).status).toBe(
    201,
  );
  expect((await call("/games", host)).data.session.id).toBe(id);
  expect((await call(`/games/${id}/end`, host, {})).status).toBe(201);
  expect((await call("/me", host)).status).toBe(200);
  expect((await call("/games", host)).data.session).toBeNull();
});

test("parallel approvals cannot exceed eight members including the host", async () => {
  const host = await person(true),
    id = await opened(host),
    guests = await Promise.all(Array.from({ length: 8 }, () => person()));
  const asked = await Promise.all(
    guests.map((g) => call(`/games/${id}/requests`, g, {})),
  );
  expect(asked.every((r) => r.status === 201)).toBe(true);
  const results = await Promise.all(
    asked.map((r) =>
      call(`/games/requests/${r.data.id}/decision`, host, { approve: true }),
    ),
  );
  expect(results.filter((r) => r.status === 201)).toHaveLength(7);
  expect(
    results.filter((r) => r.status === 409 && r.data.code === "GAME_FULL"),
  ).toHaveLength(1);
  expect((await call("/games", host)).data.members).toHaveLength(8);
}, 15000);

test("a host invitation is recipient-bound, requires friendship and reserves no slot until accepted", async () => {
  const host = await person(true),
    friend = await person(),
    other = await person(),
    id = await opened(host);
  expect(
    (await call(`/games/${id}/invitations`, host, { userId: friend.id }))
      .status,
  ).toBe(403);
  const [a, b] = [host.id, friend.id].sort();
  await db
    .insert(friendships)
    .values({ requesterId: a!, recipientId: b!, status: "accepted" });
  const invite = await call(`/games/${id}/invitations`, host, {
    userId: friend.id,
  });
  expect(invite.status).toBe(201);
  expect((await call("/games", host)).data.members).toHaveLength(1);
  expect(
    (await call(`/games/invitations/${invite.data.id}/accept`, other, {}))
      .status,
  ).toBe(404);
  expect(
    (await call(`/games/invitations/${invite.data.id}/accept`, friend, {}))
      .status,
  ).toBe(201);
  expect(
    (await call(`/games/invitations/${invite.data.id}/accept`, friend, {}))
      .status,
  ).toBe(201);
  expect((await call("/games", host)).data.members).toHaveLength(2);
});

test("removing a member and revoking a host device invalidate game admission without logging out other devices", async () => {
  const host = await person(true),
    guest = await person(),
    id = await opened(host);
  const request = await call(`/games/${id}/requests`, guest, {});
  await call(`/games/requests/${request.data.id}/decision`, host, {
    approve: true,
  });
  const membership = (await call("/games", guest)).data.self.memberId;
  expect(
    (
      await call(
        `/games/${id}/members/${membership}`,
        host,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(
    (await call(`/games/${id}/renew`, guest, { revision: 1 })).status,
  ).toBe(403);
  expect((await call("/me", guest)).status).toBe(200);
  const response = await call(
    "/accounts/sessions/" + host.credentialId,
    host,
    undefined,
    "DELETE",
  );
  expect(response.status).toBe(200);
  expect(
    (await db.select().from(gameSessions).where(eq(gameSessions.id, id)))[0]
      ?.status,
  ).toBe("ended");
});

test("expired host recovery reservations end games instead of retaining stale credentials indefinitely", async () => {
  const host = await person(true),
    id = await opened(host);
  await db
    .update(gameMembers)
    .set({
      leaseUntil: new Date(Date.now() - 1000),
      reservedUntil: new Date(Date.now() - 100),
    })
    .where(eq(gameMembers.sessionId, id));
  expect((await call("/games", host)).data.self).toBeNull();
  expect(
    (await db.select().from(gameSessions).where(eq(gameSessions.id, id)))[0]
      ?.status,
  ).toBe("ended");
});

test("pending requests can be cancelled without admission and a different login device cannot take over", async () => {
  const host = await person(true),
    guest = await person(),
    id = await opened(host);
  const asked = await call(`/games/${id}/requests`, guest, {});
  expect((await call(`/games/${id}/requests`, guest, {})).data.id).toBe(
    asked.data.id,
  );
  expect(
    (await call(`/games/requests/${asked.data.id}`, guest, undefined, "DELETE"))
      .status,
  ).toBe(200);
  expect(
    (
      await call(`/games/requests/${asked.data.id}/decision`, host, {
        approve: true,
      })
    ).status,
  ).toBe(409);
  const next = await call(`/games/${id}/requests`, guest, {});
  expect(
    (
      await call(`/games/requests/${next.data.id}/decision`, host, {
        approve: true,
      })
    ).status,
  ).toBe(201);
  const token = crypto.randomUUID(),
    credentialId = crypto.randomUUID();
  await db.insert(credentials).values({
    id: credentialId,
    userId: guest.id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const device = { ...guest, token, credentialId };
  expect((await call("/games", device)).data.self).toBeNull();
  expect(
    (await call(`/games/${id}/renew`, device, { revision: 1 })).status,
  ).toBe(403);
  expect((await call(`/games/${id}/leave`, device, {})).status).toBe(403);
  expect((await call("/games", guest)).data.self).not.toBeNull();
});

test("revoking hosting capability ends its game without changing the account or voice", async () => {
  const host = await person(true),
    id = await opened(host);
  await db
    .update(users)
    .set({ gameHostEnabled: false })
    .where(eq(users.id, host.id));
  const { reconcileGameHost } = await import(
    "../../apps/api/src/game-link-access"
  );
  await reconcileGameHost(host.id);
  expect((await call("/games", host)).data.session).toBeNull();
  expect((await call("/me", host)).status).toBe(200);
  expect(
    (await db.select().from(gameSessions).where(eq(gameSessions.id, id)))[0]
      ?.status,
  ).toBe("ended");
});

test("reconnecting after lease expiry rotates admission revision so old tunnel grants cannot revive", async () => {
  const host = await person(true),
    guest = await person(),
    id = await opened(host);
  const ask = await call(`/games/${id}/requests`, guest, {});
  await call(`/games/requests/${ask.data.id}/decision`, host, {
    approve: true,
  });
  const self = (await call("/games", guest)).data.self;
  await db
    .update(gameMembers)
    .set({
      leaseUntil: new Date(Date.now() - 100),
      reservedUntil: new Date(Date.now() + 60000),
    })
    .where(eq(gameMembers.id, self.memberId));
  const renewed = await call(`/games/${id}/renew`, guest, {
    revision: self.revision,
  });
  expect(renewed.status).toBe(201);
  expect(renewed.data.self.revision).toBe(self.revision + 1);
  expect(
    (await call(`/games/${id}/renew`, guest, { revision: self.revision }))
      .status,
  ).toBe(409);
});

test("pending requests stay bound to the requesting device and disappear when that device is revoked", async () => {
  const host = await person(true),
    guest = await person(),
    id = await opened(host),
    token = crypto.randomUUID(),
    credentialId = crypto.randomUUID();
  await db.insert(credentials).values({
    id: credentialId,
    userId: guest.id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const other = { ...guest, credentialId, token };
  const first = await call(`/games/${id}/requests`, guest, {});
  expect(first.status).toBe(201);
  const second = await call(`/games/${id}/requests`, other, {});
  expect(second.status).toBe(409);
  expect(second.data.code).toBe("GAME_REQUEST_OTHER_DEVICE");
  expect(
    (
      await call(
        "/accounts/sessions/" + guest.credentialId,
        other,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect((await call(`/games/${id}/requests`, other, {})).status).toBe(201);
});
