import { beforeAll, afterAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  rooms,
  members,
  credentials,
  auditLogs,
  userRoles,
  adminRoles,
  idempotency,
  invites,
  esportsSeats,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
if (!new URL(process.env.DATABASE_URL!).pathname.includes("esports"))
  throw Error("Run esports integration against its isolated database");
let app: Awaited<ReturnType<typeof createApp>>, origin: string;
const created: string[] = [];
const createdRoles: string[] = [];
async function req(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CineGather-Platform": "web",
      "X-CineGather-Features": "esports-v1",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function account() {
  const r = await req("/accounts/register", undefined, {
    username: "esports_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    displayName: "赛事测试",
    password: "Esports isolation test 123!",
  });
  expect(r.status).toBe(201);
  created.push(r.body.user.id);
  return { id: r.body.user.id as string, token: r.body.sessionToken as string };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  if (created.length)
    await db.transaction(async (tx) => {
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, created));
      await tx.delete(members).where(inArray(members.userId, created));
      await tx.delete(auditLogs).where(inArray(auditLogs.actorId, created));
      await tx.delete(userRoles).where(inArray(userRoles.userId, created));
      if (createdRoles.length)
        await tx.delete(adminRoles).where(inArray(adminRoles.id, createdRoles));
      await tx.delete(idempotency).where(inArray(idempotency.userId, created));
      await tx.delete(credentials).where(inArray(credentials.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  await pool.end();
});

test("only an explicitly authorized account creates esports rooms; superadmin grants are audited", async () => {
  const root = await account(),
    host = await account();
  expect(
    (await req("/rooms", host.token, { name: "训练赛", mode: "esports" }))
      .status,
  ).toBe(403);
  expect(
    (
      await req(`/admin/users/${host.id}/esports`, host.token, {
        enabled: true,
        reason: "cannot grant self",
      })
    ).status,
  ).toBe(403);
  await db
    .update(users)
    .set({ isSuperAdmin: true })
    .where(eq(users.id, root.id));
  expect(
    (
      await req(`/admin/users/${host.id}/esports`, root.token, {
        enabled: true,
        reason: "test authorization",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", host.token)).body.esportsRoomsEnabled).toBe(true);
  const match = await req("/rooms", host.token, {
    name: "训练赛",
    mode: "esports",
  });
  expect(match.status).toBe(201);
  expect(match.body).toMatchObject({ mode: "esports", maxMembers: 20 });
  expect(
    (await req("/rooms", host.token, { name: "普通房", maxMembers: 11 }))
      .status,
  ).toBe(400);
  expect(
    (
      await req(`/admin/users/${host.id}/esports`, root.token, {
        enabled: false,
        reason: "end test authorization",
      })
    ).status,
  ).toBe(201);
  expect(
    (await req("/rooms", host.token, { name: "another", mode: "esports" }))
      .status,
  ).toBe(403);
  const events = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, host.id));
  expect(
    events.filter((e) => e.action === "admin.esports_capability_updated"),
  ).toHaveLength(2);
});

test("storage rejects invalid seat/team pairs and unbound targeted invitations", async () => {
  const owner = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const r = await req("/rooms", owner.token, {
    name: "constraint test",
    mode: "esports",
  });
  expect(r.status).toBe(201);
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, owner.id));
  await expect(
    db
      .insert(esportsSeats)
      .values({
        roomId: r.body.id,
        userId: owner.id,
        credentialId: credential!.id,
        kind: "player",
        team: null,
      })
      .execute(),
  ).rejects.toThrow();
  const base = {
    id: crypto.randomUUID(),
    roomId: r.body.id,
    createdBy: owner.id,
    tokenHash: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60000),
    maxUses: 1,
  };
  await expect(
    db
      .insert(invites)
      .values({
        ...base,
        esportsSeat: null,
        esportsTeam: "a",
        recipientId: owner.id,
      })
      .execute(),
  ).rejects.toThrow();
  await expect(
    db
      .insert(invites)
      .values({
        ...base,
        id: crypto.randomUUID(),
        esportsSeat: "player",
        esportsTeam: "a",
      })
      .execute(),
  ).rejects.toThrow();
});

test("ordinary administrators require the dedicated esports management permission", async () => {
  const actor = await account(),
    target = await account(),
    role = crypto.randomUUID();
  createdRoles.push(role);
  await db
    .insert(adminRoles)
    .values({
      id: role,
      name: "esports test " + role,
      permissions: ["users.read", "users.manage"],
    });
  await db.insert(userRoles).values({ userId: actor.id, roleId: role });
  expect(
    (
      await req(`/admin/users/${target.id}/esports`, actor.token, {
        enabled: true,
        reason: "not enough permission",
      })
    ).status,
  ).toBe(403);
  await db
    .update(adminRoles)
    .set({ permissions: ["users.read", "users.esports"] })
    .where(eq(adminRoles.id, role));
  expect(
    (
      await req(`/admin/users/${target.id}/esports`, actor.token, {
        enabled: true,
        reason: "scoped permission",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", target.token)).body.esportsRoomsEnabled).toBe(true);
});
