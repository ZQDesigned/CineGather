import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  rooms,
  credentials,
  auditLogs,
  adminRoles,
  userRoles,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
import { media } from "../../apps/api/src/media";

const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>, base: string;
const people: { id: string; token: string }[] = [],
  roomIds: string[] = [],
  roleIds: string[] = [];
async function req(
  path: string,
  bearer: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
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
      username: `cap_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      displayName: "能力验证",
      password: "Capability account 123!",
    });
    expect(r.status).toBe(201);
    people.push({ id: r.body.user.id, token: r.body.sessionToken });
  }
  await db
    .update(users)
    .set({ isSuperAdmin: true })
    .where(eq(users.id, people[0]!.id));
});
afterAll(async () => {
  await app?.close();
  for (const id of roomIds) await media.deleteRoom(id);
  const ids = people.map((p) => p.id);
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  if (roleIds.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roleIds));
  await pool.end();
});
const patch = (target: string, actor: string, fields: object) =>
  req(
    `/admin/users/${target}/capabilities`,
    actor,
    { ...fields, reason: "能力授权验证" },
    "PATCH",
  );
async function create(token: string, maxMembers = 5) {
  const r = await req("/rooms", token, { name: "授权容量验证", maxMembers });
  if (r.status === 201) roomIds.push(r.body.id);
  return r;
}
test("default quotas, immutable creation snapshot and transfer cannot raise room limit", async () => {
  const [root, a, b] = people;
  const me = await req("/me", a!.token);
  expect(me.body.highFrameRateEnabled).toBe(false);
  expect(me.body.standardRoomMaxMembers).toBe(10);
  expect((await create(a!.token, 11)).status).toBe(403);
  const old = await create(a!.token);
  expect(old.status).toBe(201);
  expect(old.body.capacityLimit).toBe(10);
  expect(
    (await patch(a!.id, root!.token, { standardRoomMaxMembers: 17 })).status,
  ).toBe(200);
  expect(
    (await req(`/rooms/${old.body.id}/settings`, a!.token, { maxMembers: 11 }))
      .status,
  ).toBe(403);
  const fresh = await create(a!.token, 17);
  expect(fresh.status).toBe(201);
  expect(fresh.body.capacityLimit).toBe(17);
  expect((await create(a!.token, 18)).status).toBe(403);
  await req(`/rooms/${fresh.body.id}/join`, a!.token, {});
  await req(`/rooms/${fresh.body.id}/join`, b!.token, {});
  const originalParticipants = media.participants;
  try {
    media.participants = async (id, ...args) =>
      id === fresh.body.id
        ? ([{ identity: a!.id }, { identity: b!.id }] as Awaited<
            ReturnType<typeof originalParticipants>
          >)
        : originalParticipants.call(media, id, ...args);
    expect(
      (
        await req(
          `/rooms/${fresh.body.id}/members/${b!.id}/owner`,
          a!.token,
          {},
        )
      ).status,
    ).toBe(201);
  } finally {
    media.participants = originalParticipants;
  }

  expect(
    (await patch(a!.id, root!.token, { standardRoomMaxMembers: 10 })).status,
  ).toBe(200);
  expect(
    (await patch(b!.id, root!.token, { standardRoomMaxMembers: 25 })).status,
  ).toBe(200);
  expect(
    (
      await req(`/rooms/${fresh.body.id}/settings`, b!.token, {
        maxMembers: 18,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await req(`/rooms/${fresh.body.id}/settings`, b!.token, {
        maxMembers: 16,
      })
    ).status,
  ).toBe(201);
  expect(
    (await req(`/rooms/${fresh.body.id}`, b!.token)).body.capacityLimit,
  ).toBe(17);
  const max = await create(b!.token, 25);
  expect(max.status).toBe(201);
  expect(max.body.capacityLimit).toBe(25);
  expect((await create(b!.token, 26)).status).toBe(400);
});
test("per-field permissions reject mixed patches atomically and audit only actual changes", async () => {
  const [root, a, b] = people;
  const role = crypto.randomUUID();
  roleIds.push(role);
  await db.insert(adminRoles).values({
    id: role,
    name: `cap_${role}`,
    permissions: ["users.read", "users.high-frame-rate"],
  });
  await db.insert(userRoles).values({ userId: a!.id, roleId: role });
  expect(
    (
      await patch(b!.id, a!.token, {
        highFrameRateEnabled: true,
        standardRoomMaxMembers: 20,
      })
    ).status,
  ).toBe(403);
  expect((await req("/me", b!.token)).body.highFrameRateEnabled).toBe(false);
  expect(
    (await patch(b!.id, a!.token, { highFrameRateEnabled: true })).status,
  ).toBe(200);
  expect((await req("/me", b!.token)).body.highFrameRateEnabled).toBe(true);
  expect(
    (await patch(b!.id, root!.token, { standardRoomMaxMembers: 26 })).status,
  ).toBe(400);
  expect(
    (await patch(b!.id, b!.token, { screenShareEnabled: true })).status,
  ).toBe(403);
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, b!.id));
  expect(logs.some((l) => l.action === "admin.capabilities_updated")).toBe(
    true,
  );
});
test("game quality is checked on acquisition, native publication and renewal without bypassing base share permission", async () => {
  const [root, , b] = people;
  await patch(b!.id, root!.token, {
    screenShareEnabled: true,
    highFrameRateEnabled: false,
  });
  const room = await create(b!.token);
  const id = room.body.id;
  await req(`/rooms/${id}/join`, b!.token, {});
  const original = media.participants,
    share = media.setShare;
  try {
    media.participants = async (room, ...args) =>
      room === id
        ? ([{ identity: b!.id }] as Awaited<ReturnType<typeof original>>)
        : original.call(media, room, ...args);
    media.setShare = async (room, ...args) => {
      if (room !== id) await share.call(media, room, ...args);
    };
    expect(
      (await req(`/rooms/${id}/share-lease`, b!.token, { quality: "game" }))
        .status,
    ).toBe(403);
    const basic = await req(`/rooms/${id}/share-lease`, b!.token, {
      quality: "cinema",
    });
    expect(basic.status).toBe(201);
    expect(
      (
        await req(`/rooms/${id}/share-lease/preempt`, b!.token, {
          quality: "game",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(`/rooms/${id}/share-lease/native`, b!.token, {
          leaseId: basic.body.leaseId,
          revision: basic.body.revision,
          quality: "game",
        })
      ).status,
    ).toBe(403);
    await req(
      `/rooms/${id}/share-lease`,
      b!.token,
      { leaseId: basic.body.leaseId, revision: basic.body.revision },
      "DELETE",
    );
    await patch(b!.id, root!.token, { highFrameRateEnabled: true });
    const game = await req(`/rooms/${id}/share-lease`, b!.token, {
      quality: "game",
    });
    expect(game.status).toBe(201);
    expect(
      (
        await req(`/rooms/${id}/share-lease/native`, b!.token, {
          leaseId: game.body.leaseId,
          revision: game.body.revision,
          quality: "cinema",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req(`/rooms/${id}/share-lease/native`, b!.token, {
          leaseId: game.body.leaseId,
          revision: game.body.revision,
          quality: "game",
        })
      ).status,
    ).toBe(201);
    await patch(b!.id, root!.token, { highFrameRateEnabled: false });
    expect(
      (
        await req(`/rooms/${id}/share-lease/renew`, b!.token, {
          leaseId: game.body.leaseId,
          revision: game.body.revision,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          `/rooms/${id}/share-lease`,
          b!.token,
          { leaseId: game.body.leaseId, revision: game.body.revision },
          "DELETE",
        )
      ).status,
    ).toBe(200);
  } finally {
    media.participants = original;
    media.setShare = share;
  }
});
