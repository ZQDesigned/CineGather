import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  credentials,
  rooms,
  members,
  auditLogs,
  idempotency,
  leases,
  nativePublications,
  adminRoles,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
import { hash, token } from "../../apps/api/src/context";
import { media } from "../../apps/api/src/media";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
const ids: string[] = [];
const roleIds: string[] = [];
const password = "Admin fixture password 123!";
const prefix = `adm_${crypto.randomUUID().slice(0, 8)}`;
async function req(path: string, bearer?: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
async function account(suffix: string) {
  const r = await req("/accounts/register", undefined, {
    username: `${prefix}_${suffix}`,
    displayName: `管理验证${suffix}`,
    password,
  });
  expect(r.status).toBe(201);
  ids.push(r.body.user.id);
  return r.body;
}
let admin: Awaited<ReturnType<typeof account>>;
let regular: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  admin = await account("admin");
  regular = await account("regular");
  await db.execute(
    `UPDATE users SET is_super_admin=true WHERE id='${admin.user.id}'`,
  );
});
afterAll(async () => {
  await app?.close();
  if (ids.length)
    await db.transaction(async (tx) => {
      await tx.delete(members).where(inArray(members.userId, ids));
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, ids));
      await tx.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
      await tx.delete(idempotency).where(inArray(idempotency.userId, ids));
      await tx.delete(credentials).where(inArray(credentials.userId, ids));
      await tx.delete(users).where(inArray(users.id, ids));
    });
  if (roleIds.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roleIds));
  await pool.end();
});
test("guest creation and pre-existing anonymous credentials cannot access the application", async () => {
  expect(
    (await req("/guests", undefined, { displayName: "禁止访客" })).status,
  ).not.toBe(201);
  const id = crypto.randomUUID(),
    secret = token();
  ids.push(id);
  await db.insert(users).values({ id, displayName: "历史访客" });
  await db.insert(credentials).values({
    id: crypto.randomUUID(),
    userId: id,
    kind: "guest",
    secretHash: hash(secret),
    expiresAt: new Date(Date.now() + 60000),
  });
  expect((await req("/me", secret)).status).toBe(401);
  expect((await req("/rooms", secret)).status).toBe(401);
  expect(
    (
      await req("/accounts/register", secret, {
        username: `${prefix}_forged`,
        displayName: "伪升级",
        password,
      })
    ).status,
  ).toBe(401);
});
test("only active administrators can list data or mutate it; signup cannot set role", async () => {
  expect((await req("/admin/overview")).status).toBe(401);
  expect((await req("/ADMIN/overview", regular.sessionToken)).status).toBe(403);
  for (const path of [
    "/admin/overview",
    "/admin/users",
    "/admin/rooms",
    "/admin/audit",
  ])
    expect((await req(path, regular.sessionToken)).status).toBe(403);
  expect(
    (
      await req(
        `/admin/users/${regular.user.id}/disable`,
        regular.sessionToken,
        { reason: "无权操作" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await req("/accounts/register", undefined, {
        username: `${prefix}_forged`,
        displayName: "越权",
        password,
        role: "admin",
      })
    ).status,
  ).toBe(400);
  expect((await req("/me", admin.sessionToken)).body.isSuperAdmin).toBe(true);
});
test("admin lists are paginated/searchable and never expose secrets", async () => {
  const r = await req(
    `/admin/users?q=${prefix}&page=1&pageSize=1`,
    admin.sessionToken,
  );
  expect(r.status).toBe(200);
  expect(r.body.items).toHaveLength(1);
  expect(r.body.items[0].activeSessions).toBeGreaterThan(0);
  expect(r.body.total).toBe(2);
  expect(JSON.stringify(r.body)).not.toMatch(
    /password|secretHash|sessionToken/i,
  );
  expect(
    (await req("/admin/users?pageSize=10000", admin.sessionToken)).status,
  ).toBe(400);
  const overview = await req("/admin/overview", admin.sessionToken);
  expect(overview.status).toBe(200);
  expect(overview.body.accounts).toBeGreaterThanOrEqual(2);
});
test("disable revokes all sessions, removes media, transfers owner and rejects login until enabled", async () => {
  const a = await account("disable"),
    b = await account("successor");
  const second = await req("/accounts/login", undefined, {
    username: a.user.username,
    password,
  });
  const room = await req("/rooms", a.sessionToken, {
    name: `${prefix}停用房间`,
  });
  expect(room.status).toBe(201);
  await req(`/rooms/${room.body.id}/join`, a.sessionToken, {});
  await req(`/rooms/${room.body.id}/join`, b.sessionToken, {});
  expect(
    (
      await req(`/admin/users/${a.user.id}/disable`, admin.sessionToken, {
        reason: "本机停用验证",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", a.sessionToken)).status).toBe(401);
  expect((await req("/me", a.sessionToken)).body.code).toBe("ACCOUNT_DISABLED");
  expect((await req("/me", second.body.sessionToken)).status).toBe(401);
  expect(
    (
      await req("/accounts/login", undefined, {
        username: a.user.username,
        password,
      })
    ).status,
  ).toBe(403);
  expect(
    (await req(`/rooms/${room.body.id}`, b.sessionToken)).body.ownerUserId,
  ).toBe(b.user.id);
  expect(
    (
      await req(`/admin/users/${a.user.id}/enable`, admin.sessionToken, {
        reason: "恢复验证",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", a.sessionToken)).status).toBe(401);
  expect(
    (
      await req("/accounts/login", undefined, {
        username: a.user.username,
        password,
      })
    ).status,
  ).toBe(201);
});
test("session revocation requires a reason and cannot target administrators", async () => {
  expect(
    (
      await req(`/admin/users/${admin.user.id}/disable`, admin.sessionToken, {
        reason: "不能停用自己",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req(
        `/admin/users/${admin.user.id}/revoke-sessions`,
        admin.sessionToken,
        { reason: "不能撤销管理账号" },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await req(
        `/admin/users/${regular.user.id}/revoke-sessions`,
        admin.sessionToken,
        {},
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await req(
        `/admin/users/${regular.user.id}/revoke-sessions`,
        admin.sessionToken,
        { reason: "会话撤销验证" },
      )
    ).status,
  ).toBe(201);
  expect((await req("/me", regular.sessionToken)).status).toBe(401);
  expect(
    (
      await req("/accounts/login", undefined, {
        username: regular.user.username,
        password,
      })
    ).status,
  ).toBe(201);
});
test("closing a room invalidates invitations, leases and media, with an auditable reason", async () => {
  const a = await account("close");
  const r = await req("/rooms", a.sessionToken, { name: `${prefix}关闭房间` });
  const id = r.body.id;
  const invitation = await req(`/rooms/${id}/invites`, a.sessionToken, {});
  expect(
    (
      await req(`/admin/rooms/${id}/revoke-share`, admin.sessionToken, {
        reason: "停止共享验证",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await req(`/admin/rooms/${id}/close`, admin.sessionToken, {
        reason: "关闭房间验证",
      })
    ).status,
  ).toBe(201);
  expect((await req(`/rooms/${id}`, a.sessionToken)).status).toBe(404);
  expect(
    (
      await req(`/rooms/${id}/join`, a.sessionToken, {
        inviteToken: invitation.body.token,
      })
    ).status,
  ).toBe(404);
  expect(await media.client.listRooms([id])).toHaveLength(0);
  expect(
    (
      await req(`/admin/rooms/${id}/close`, admin.sessionToken, {
        reason: "重复关闭验证",
      })
    ).status,
  ).toBe(201);
  const audit = await req("/admin/audit", admin.sessionToken);
  expect(audit.status).toBe(200);
  expect(
    audit.body.items.some(
      (x: { action: string; reason: string }) =>
        x.action === "admin.room_closed" && x.reason === "关闭房间验证",
    ),
  ).toBe(true);
  expect(JSON.stringify(audit.body)).not.toMatch(
    /passwordHash|sessionToken|secretHash/,
  );
});
test("administrator status is checked on every request", async () => {
  await db.execute(
    `UPDATE users SET is_super_admin=false WHERE id='${admin.user.id}'`,
  );
  expect((await req("/admin/overview", admin.sessionToken)).status).toBe(403);
  await db.execute(
    `UPDATE users SET is_super_admin=true WHERE id='${admin.user.id}'`,
  );
});

test("administrator share revocation removes native ingress and source permissions while retaining the room", async () => {
  const a = await account("native");
  expect(
    (
      await req(`/admin/users/${a.user.id}/screen-share`, admin.sessionToken, {
        enabled: true,
        reason: "开启受控共享测试",
      })
    ).status,
  ).toBe(201);
  const room = (
    await req("/rooms", a.sessionToken, { name: `${prefix}共享撤销` })
  ).body;
  const list = media.participants,
    set = media.setShare;
  const permissions: boolean[] = [];
  try {
    media.participants = async (id, ...rest) =>
      id === room.id
        ? ([{ identity: a.user.id }] as Awaited<ReturnType<typeof list>>)
        : list.call(media, id, ...rest);
    media.setShare = async (id, userId, allow) => {
      if (id === room.id) permissions.push(allow);
      else await set.call(media, id, userId, allow);
    };
    const lease = await req(
      `/rooms/${room.id}/share-lease`,
      a.sessionToken,
      {},
    );
    expect(lease.status).toBe(201);
    const publication = await req(
      `/rooms/${room.id}/share-lease/native`,
      a.sessionToken,
      { leaseId: lease.body.leaseId, revision: lease.body.revision },
    );
    expect(publication.status).toBe(201);
    expect(
      (await media.ingress.listIngress({ roomName: room.id })).length,
    ).toBe(1);
    const listing = await req(
      `/admin/rooms?q=${room.code}`,
      admin.sessionToken,
    );
    expect(listing.body.items[0].sharing).toBe(true);
    expect(
      (
        await req(`/admin/rooms/${room.id}/revoke-share`, admin.sessionToken, {
          reason: "撤销原生推流验证",
        })
      ).status,
    ).toBe(201);
    expect(permissions.at(-1)).toBe(false);
    expect(
      await db
        .select()
        .from(nativePublications)
        .where(eq(nativePublications.roomId, room.id)),
    ).toHaveLength(0);
    expect(await media.ingress.listIngress({ roomName: room.id })).toHaveLength(
      0,
    );
    expect(
      (await db.select().from(leases).where(eq(leases.roomId, room.id)))[0]!
        .holderUserId,
    ).toBeNull();
    expect((await req(`/rooms/${room.id}`, a.sessionToken)).status).toBe(200);
    expect(
      (
        await req(`/rooms/${room.id}/share-lease/renew`, a.sessionToken, {
          leaseId: lease.body.leaseId,
          revision: lease.body.revision,
        })
      ).status,
    ).toBe(409);
    const lease2 = await req(
      `/rooms/${room.id}/share-lease`,
      a.sessionToken,
      {},
    );
    expect(lease2.status).toBe(201);
    expect(
      (
        await req(`/rooms/${room.id}/share-lease/native`, a.sessionToken, {
          leaseId: lease2.body.leaseId,
          revision: lease2.body.revision,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await req(
          `/admin/users/${a.user.id}/screen-share`,
          admin.sessionToken,
          { enabled: false, reason: "撤销账号共享能力" },
        )
      ).status,
    ).toBe(201);
    expect(await media.ingress.listIngress({ roomName: room.id })).toHaveLength(
      0,
    );
    expect(
      (await db.select().from(leases).where(eq(leases.roomId, room.id)))[0]!
        .holderUserId,
    ).toBeNull();
    expect(
      (await req(`/rooms/${room.id}/share-lease`, a.sessionToken, {})).body
        .code,
    ).toBe("SCREEN_SHARE_UNAVAILABLE");
    expect(
      (
        await req(`/rooms/${room.id}/share-lease/renew`, a.sessionToken, {
          leaseId: lease2.body.leaseId,
          revision: lease2.body.revision,
        })
      ).body.code,
    ).toBe("SCREEN_SHARE_UNAVAILABLE");
    expect(
      (
        await req(`/rooms/${room.id}/share-lease/native`, a.sessionToken, {
          leaseId: lease2.body.leaseId,
          revision: lease2.body.revision,
        })
      ).body.code,
    ).toBe("SCREEN_SHARE_UNAVAILABLE");
    expect((await req(`/rooms/${room.id}`, a.sessionToken)).status).toBe(200);
  } finally {
    media.participants = list;
    media.setShare = set;
    await req(`/admin/rooms/${room.id}/close`, admin.sessionToken, {
      reason: "结束共享测试",
    });
  }
});

test("only the dedicated capability permission or superadmin may grant sharing", async () => {
  const target = await account("ability"),
    operator = await account("operator");
  const path = `/admin/users/${target.user.id}/screen-share`;
  expect(target.user.screenShareEnabled).toBe(false);
  const body = { enabled: true, reason: "共享能力授权验证" };
  expect((await req(path, target.sessionToken, body)).status).toBe(403);
  const roles = (await req("/admin/roles", admin.sessionToken)).body.items;
  const builtin = roles.find((r: { builtIn: boolean }) => r.builtIn);
  await req(`/admin/users/${operator.user.id}/roles`, admin.sessionToken, {
    roleIds: [builtin.id],
    reason: "普通管理员权限验证",
  });
  expect((await req(path, operator.sessionToken, body)).status).toBe(403);
  const role = await req("/admin/roles", admin.sessionToken, {
    name: prefix + "共享授权",
    permissions: ["users.read", "users.screen-share"],
    reason: "独立权限验证",
  });
  expect(role.status).toBe(201);
  roleIds.push(role.body.id);
  await req(`/admin/users/${operator.user.id}/roles`, admin.sessionToken, {
    roleIds: [role.body.id],
    reason: "授予独立共享管理权限",
  });
  expect((await req(path, operator.sessionToken, body)).status).toBe(201);
  expect((await req("/me", target.sessionToken)).body.screenShareEnabled).toBe(
    true,
  );
  const listing = await req(
    `/admin/users?q=${target.user.username}`,
    operator.sessionToken,
  );
  expect(listing.body.items[0].screenShareEnabled).toBe(true);
  expect(
    (await req(path, operator.sessionToken, { ...body, enabled: false }))
      .status,
  ).toBe(201);
  expect((await req("/me", target.sessionToken)).body.screenShareEnabled).toBe(
    false,
  );
  const room = (
    await req("/rooms", admin.sessionToken, { name: prefix + "超管无默认共享" })
  ).body;
  expect(
    (await req(`/rooms/${room.id}/share-lease`, admin.sessionToken, {})).body
      .code,
  ).toBe("SCREEN_SHARE_UNAVAILABLE");
});
