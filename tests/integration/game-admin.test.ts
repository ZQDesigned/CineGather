import { beforeAll, afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { inArray, or } from "drizzle-orm";
import {
  users,
  credentials,
  gameSessions,
  auditLogs,
  adminRoles,
  userRoles,
  rooms,
} from "@cinegather/database";
import {
  protocolHeaders,
  type AdminSessionEvent,
  type AdminGameMember,
} from "@cinegather/contracts";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/core/context";
let app: Awaited<ReturnType<typeof createApp>>, origin: string;
const people: string[] = [],
  roles: string[] = [];
async function person(
  kind: "root" | "host" | "guest" | "reader" | "auditor" | "manager",
) {
  const id = randomUUID(),
    cid = randomUUID(),
    token = randomUUID();
  people.push(id);
  await db.insert(users).values({
    id,
    username: "game_admin_" + id.replaceAll("-", "").slice(0, 12),
    displayName: kind,
    passwordHash: "fixture",
    isSuperAdmin: kind === "root",
    gameHostEnabled: kind === "host",
  });
  await db.insert(credentials).values({
    id: cid,
    userId: id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return { id, token, kind };
}
type Person = Awaited<ReturnType<typeof person>>;
async function call(
  path: string,
  who: Person,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + who.token,
      "Content-Type": "application/json",
      "X-CineGather-Platform": "win32",
      "X-CineGather-Version": "0.1.35",
      ...protocolHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
let root: Person, host: Person, guest: Person, sessionId: string;
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
  root = await person("root");
  host = await person("host");
  guest = await person("guest");
});
afterAll(async () => {
  await app.close();
  const owned = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(inArray(gameSessions.hostUserId, people));
  const ownedRooms = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(inArray(rooms.ownerUserId, people));
  const targets = [...owned, ...ownedRooms].map((r) => r.id);
  await db
    .delete(auditLogs)
    .where(
      or(
        inArray(auditLogs.actorId, people),
        targets.length ? inArray(auditLogs.targetId, targets) : undefined,
      ),
    );
  await db.delete(rooms).where(inArray(rooms.ownerUserId, people));
  await db.delete(gameSessions).where(inArray(gameSessions.hostUserId, people));
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, people));
  await db.delete(users).where(inArray(users.id, people));
  if (roles.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roles));
});
test("administrators can list sessions with searchable host identity and no native secrets", async () => {
  const made = await call("/games", host, {
    game: "minecraft-java",
    name: "audit_world_unique",
  });
  expect(made.status).toBe(201);
  sessionId = made.data.session.id;
  const denied = await call("/admin/games", guest);
  expect(denied.status).toBe(403);
  const listed = await call("/admin/games?q=audit_world_unique", root);
  expect(listed.status).toBe(200);
  expect(listed.data.total).toBe(1);
  expect(listed.data.items[0].hostName).toBe("host");
  expect(JSON.stringify(listed.data)).not.toMatch(
    /credential|secret|token|127\.0\.0\.1/i,
  );
});
test("game lifecycle history records admission and voluntary leave with readable session metadata", async () => {
  await call(`/games/${sessionId}/ready`, host, {});
  const request = await call(`/games/${sessionId}/requests`, guest, {});
  expect(request.status).toBe(201);
  await call(`/games/requests/${request.data.id}/decision`, host, {
    approve: true,
  });
  await call(`/games/${sessionId}/leave`, guest, {});
  const events = await call(`/admin/games/${sessionId}/events`, root);
  expect(events.status).toBe(200);
  const actions = events.data.items.map((e: AdminSessionEvent) => e.action);
  for (const a of [
    "game.created",
    "game.join_requested",
    "game.request_approved",
    "game.member_joined",
    "game.member_left",
  ])
    expect(actions).toContain(a);
  expect(
    events.data.items.every(
      (e: AdminSessionEvent) => e.sessionName === "audit_world_unique",
    ),
  ).toBe(true);
  expect(JSON.stringify(events.data)).not.toMatch(
    /credential|secret|bearer|tunnelSecret/i,
  );
  const members = await call(`/admin/games/${sessionId}/members`, root);
  expect(members.status).toBe(200);
  expect(members.data.total).toBe(2);
  expect(
    members.data.items.find((m: AdminGameMember) => m.userId === guest.id)
      .active,
  ).toBe(false);
});
test("forced end requires management permission and a reason, is atomic and audited once", async () => {
  expect(
    (
      await call(`/admin/games/${sessionId}/close`, guest, {
        reason: "not allowed",
      })
    ).status,
  ).toBe(403);
  expect(
    (await call(`/admin/games/${sessionId}/close`, root, { reason: "" }))
      .status,
  ).toBe(400);
  expect(
    (
      await call(`/admin/games/${sessionId}/close`, root, {
        reason: "维护验证",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call(`/admin/games/${sessionId}/close`, root, {
        reason: "维护验证",
      })
    ).status,
  ).toBe(201);
  expect((await call("/games", host)).data.session).toBeNull();
  const events = await call(`/admin/games/${sessionId}/events`, root);
  const closed = events.data.items.filter(
    (e: AdminSessionEvent) => e.action === "admin.game_closed",
  );
  expect(closed).toHaveLength(1);
  expect(closed[0].reason).toBe("维护验证");
  expect(closed[0].actorName).toBe("root");
});

async function withPermissions(
  kind: "reader" | "auditor" | "manager",
  permissions: string[],
) {
  const who = await person(kind),
    rid = randomUUID();
  roles.push(rid);
  await db.insert(adminRoles).values({ id: rid, name: rid, permissions });
  await db.insert(userRoles).values({ userId: who.id, roleId: rid });
  return who;
}
test("game read, history and force-close require independent permissions", async () => {
  const reader = await withPermissions("reader", ["games.read"]);
  const auditor = await withPermissions("auditor", ["audit.read"]);
  const manager = await withPermissions("manager", [
    "rooms.read",
    "rooms.manage",
    "audit.read",
  ]);
  expect((await call("/admin/games", reader)).status).toBe(200);
  expect((await call(`/admin/games/${sessionId}/members`, reader)).status).toBe(
    200,
  );
  expect((await call(`/admin/games/${sessionId}/events`, reader)).status).toBe(
    403,
  );
  expect((await call(`/admin/games/${sessionId}/events`, auditor)).status).toBe(
    403,
  );
  expect(
    (
      await call(`/admin/games/${sessionId}/close`, manager, {
        reason: "denied",
      })
    ).status,
  ).toBe(403);
});
test("voice room history includes creation, joins, leave and kick without duplicate retries", async () => {
  const made = await call("/rooms", host, {
    name: "voice_audit_unique",
    maxMembers: 5,
  });
  expect(made.status).toBe(201);
  const id = made.data.id;
  expect((await call(`/rooms/${id}/join`, host, {})).status).toBe(201);
  expect((await call(`/rooms/${id}/join`, guest, {})).status).toBe(201);
  await call(`/rooms/${id}/join`, guest, {});
  await call(`/rooms/${id}/leave`, guest, {});
  await call(`/rooms/${id}/leave`, guest, {});
  await call(`/rooms/${id}/join`, guest, {});
  await call(
    `/rooms/${id}/members/${guest.id}`,
    host,
    { ban: false },
    "DELETE",
  );
  await call(
    `/rooms/${id}/members/${guest.id}`,
    host,
    { ban: false },
    "DELETE",
  );
  const history = await call(`/admin/rooms/${id}/events`, root);
  expect(history.status).toBe(200);
  const es = history.data.items;
  expect(
    es.filter((e: AdminSessionEvent) => e.action === "room.created"),
  ).toHaveLength(1);
  expect(
    es.filter(
      (e: AdminSessionEvent) =>
        e.action === "room.joined" && e.actorName === "guest",
    ),
  ).toHaveLength(2);
  expect(
    es.filter(
      (e: AdminSessionEvent) =>
        e.action === "room.left" && e.actorName === "guest",
    ),
  ).toHaveLength(1);
  const kicks = es.filter(
    (e: AdminSessionEvent) => e.action === "member.kicked",
  );
  expect(kicks).toHaveLength(1);
  expect(kicks[0].memberName).toBe("guest");
  expect(
    es.every((e: AdminSessionEvent) => e.sessionName === "voice_audit_unique"),
  ).toBe(true);
  expect((await call(`/admin/rooms/${id}/events`, guest)).status).toBe(403);
  const reader = await withPermissions("reader", ["rooms.read"]);
  expect((await call(`/admin/rooms/${id}/events`, reader)).status).toBe(403);
  // Closed rooms retain history for later review.
  await call(`/rooms/${id}/leave`, host, {});
  expect(
    (await call(`/admin/rooms/${id}/events`, root)).data.items.some(
      (e: AdminSessionEvent) => e.action === "room.closed_empty",
    ),
  ).toBe(true);
});

test("old clients poll silently but cannot use game operations; cleanup and normal rooms remain available", async () => {
  const h = await person("host");
  const made = await call("/games", h, {
    game: "minecraft-java",
    name: "compatibility_world",
  });
  expect(made.status).toBe(201);
  const oldHeaders = {
    Authorization: "Bearer " + h.token,
    "Content-Type": "application/json",
    "X-CineGather-Platform": "win32",
    "X-CineGather-Version": "0.1.34",
    "X-CineGather-Protocols": JSON.stringify({
      "game.minecraft-java": [1],
      "room.standard": [1],
    }),
  };
  const oldCall = (path: string, method = "GET", body?: unknown) =>
    fetch(origin + "/api/v1" + path, {
      method,
      headers: oldHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  expect((await oldCall("/me")).status).toBe(200);
  expect((await oldCall("/rooms")).status).toBe(200);
  // This discovery request runs every five seconds, including on the home page.
  for (let n = 0; n < 3; n++) {
    const poll = await oldCall("/games");
    expect(poll.status).toBe(200);
    expect(poll.headers.get("X-CineGather-Update-Scope")).not.toBe("feature");
    expect(await poll.json()).toEqual({
      session: null,
      self: null,
      members: [],
      requests: [],
      invitations: [],
    });
  }
  // A quiet discovery response must not authorize any game action or expose an
  // invitation/credential. A supported client still sees the real session.
  expect((await call("/games", h)).data.session.id).toBe(made.data.session.id);
  for (const [path, body] of [
    ["/games", { game: "minecraft-java", name: "old-client" }],
    ["/games/lookup", { code: made.data.session.code }],
    [`/games/${made.data.session.id}/renew`, { revision: 1 }],
  ] as const) {
    const blocked = await oldCall(path, "POST", body);
    expect([409, 426]).toContain(blocked.status);
    expect((await blocked.json()).code).toBe("FEATURE_UPDATE_REQUIRED");
  }
  expect([409, 426]).toContain(
    (await oldCall(`/games/${made.data.session.id}/ready`, "POST", {})).status,
  );
  expect(
    (await oldCall(`/games/${made.data.session.id}/leave`, "POST", {})).status,
  ).toBe(201);
  expect((await call("/games", h)).data.session).toBeNull();
});
