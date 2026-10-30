import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  credentials,
  auditLogs,
  announcements,
  adminRoles,
  userRoles,
  idempotency,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>, base: string;
const ids: string[] = [],
  posts: string[] = [],
  roles: string[] = [];
let root: { user: { id: string }; sessionToken: string },
  member: typeof root,
  manager: typeof root;
async function req(
  path: string,
  who?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(who ? { Authorization: "Bearer " + who } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
async function account(name: string) {
  const r = await req("/accounts/register", undefined, {
    username: "ann_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    displayName: name,
    password: "Announcement fixture password 123!",
  });
  expect(r.status).toBe(201);
  ids.push(r.body.user.id);
  return r.body;
}
const draft = (extra: object = {}) => ({
  title: "维护通知",
  body: "这是本地验证公告。<script>仅作为文字</script>",
  kind: "maintenance",
  ...extra,
});
async function create(extra: object = {}) {
  const r = await req("/admin/announcements", root.sessionToken, draft(extra));
  expect(r.status).toBe(201);
  posts.push(r.body.id);
  return r.body;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  root = await account("公告超管验证");
  member = await account("公告普通用户验证");
  manager = await account("公告管理员验证");
  await db
    .update(users)
    .set({ isSuperAdmin: true })
    .where(eq(users.id, root.user.id));
});
afterAll(async () => {
  await app?.close();
  if (posts.length)
    await db.delete(announcements).where(inArray(announcements.id, posts));
  if (ids.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(idempotency).where(inArray(idempotency.userId, ids));
    await db.delete(userRoles).where(inArray(userRoles.userId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  if (roles.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roles));
  await pool.end();
});
test("drafts stay private; explicit publish enters public feed and claim/read is once per account", async () => {
  const a = await create();
  expect(
    (await req("/announcements")).body.items.some(
      (p: { id: string }) => p.id === a.id,
    ),
  ).toBe(false);
  expect((await req("/admin/announcements", member.sessionToken)).status).toBe(
    403,
  );
  expect(
    (
      await req(
        "/admin/announcements/" + a.id + "/publish",
        member.sessionToken,
        {},
      )
    ).status,
  ).toBe(403);
  expect(
    (await req("/announcements/" + a.id + "/receive", member.sessionToken, {}))
      .status,
  ).toBe(404);
  const p = await req(
    "/admin/announcements/" + a.id + "/publish",
    root.sessionToken,
    {},
  );
  expect(p.status).toBe(201);
  expect(p.body.state).toBe("active");
  const feed = await req("/announcements");
  expect(feed.status).toBe(200);
  expect(
    feed.body.items.find((p: { id: string }) => p.id === a.id).body,
  ).toContain("<script>");
  expect(JSON.stringify(feed.body)).not.toContain(root.user.id);
  expect(
    (await req("/announcements/" + a.id + "/receive", member.sessionToken, {}))
      .body.remind,
  ).toBe(true);
  expect(
    (await req("/announcements/" + a.id + "/receive", member.sessionToken, {}))
      .body.remind,
  ).toBe(false);
  expect(
    (await req("/announcements/inbox", member.sessionToken)).body.items.find(
      (p: { id: string }) => p.id === a.id,
    ),
  ).toMatchObject({ received: true, read: false });
  expect(
    (await req("/announcements/" + a.id + "/read", member.sessionToken, {}))
      .status,
  ).toBe(201);
  expect(
    (await req("/announcements/inbox", member.sessionToken)).body.items.find(
      (p: { id: string }) => p.id === a.id,
    ).read,
  ).toBe(true);
  expect(
    (await req("/announcements/inbox", root.sessionToken)).body.items.find(
      (p: { id: string }) => p.id === a.id,
    ).read,
  ).toBe(false);
  expect(
    (
      await req(
        "/admin/announcements/" + a.id + "/withdraw",
        root.sessionToken,
        {},
      )
    ).body.state,
  ).toBe("withdrawn");
  expect(
    (await req("/announcements")).body.items.some(
      (p: { id: string }) => p.id === a.id,
    ),
  ).toBe(false);
});
test("dedicated announcement permission can publish, later revocation takes immediate effect", async () => {
  const role = await req("/admin/roles", root.sessionToken, {
    name: "公告权限" + crypto.randomUUID().slice(0, 6),
    permissions: ["announcements.read", "announcements.manage"],
    reason: "本地公告权限测试",
  });
  expect(role.status).toBe(201);
  roles.push(role.body.id);
  await db
    .insert(userRoles)
    .values({ userId: manager.user.id, roleId: role.body.id });
  const d = await req(
    "/admin/announcements",
    manager.sessionToken,
    draft({ title: "权限公告" }),
  );
  expect(d.status).toBe(201);
  posts.push(d.body.id);
  await db.delete(userRoles).where(eq(userRoles.userId, manager.user.id));
  expect(
    (
      await req(
        "/admin/announcements/" + d.body.id + "/publish",
        manager.sessionToken,
        {},
      )
    ).status,
  ).toBe(403);
});
test("scheduled announcements stay private until due and expire without replay reminders", async () => {
  const start = Date.now() + 1500,
    end = start + 1600,
    a = await create({
      startsAt: new Date(start).toISOString(),
      expiresAt: new Date(end).toISOString(),
    });
  expect(
    (
      await req(
        "/admin/announcements/" + a.id + "/publish",
        root.sessionToken,
        {},
      )
    ).body.state,
  ).toBe("scheduled");
  expect(
    (await req("/announcements")).body.items.some(
      (p: { id: string }) => p.id === a.id,
    ),
  ).toBe(false);
  await Bun.sleep(1750);
  expect(
    (await req("/announcements")).body.items.find(
      (p: { id: string }) => p.id === a.id,
    ).state,
  ).toBe("active");
  await Bun.sleep(1600);
  expect(
    (await req("/announcements/" + a.id + "/receive", member.sessionToken, {}))
      .body.remind,
  ).toBe(false);
  expect(
    (await req("/announcements")).body.items.find(
      (p: { id: string }) => p.id === a.id,
    ).state,
  ).toBe("expired");
  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, a.id));
  expect(audits.map((a) => a.action)).toContain("admin.announcement_publish");
});

test("concurrent reminder claims stay unique and cancellation prevents a scheduled broadcast", async () => {
  const a = await create();
  await req("/admin/announcements/" + a.id + "/publish", root.sessionToken, {});
  const claimed = await Promise.all(
    Array.from({ length: 6 }, () =>
      req("/announcements/receive", member.sessionToken, { ids: [a.id] }),
    ),
  );
  expect(claimed.reduce((n, r) => n + r.body.remindIds.length, 0)).toBe(1);
  const now = Date.now(),
    cancelled = await create({
      startsAt: new Date(now + 1300).toISOString(),
      expiresAt: new Date(now + 5000).toISOString(),
    });
  await req(
    "/admin/announcements/" + cancelled.id + "/publish",
    root.sessionToken,
    {},
  );
  await req(
    "/admin/announcements/" + cancelled.id + "/withdraw",
    root.sessionToken,
    {},
  );
  await Bun.sleep(1450);
  expect(
    (await req("/announcements")).body.items.some(
      (p: { id: string }) => p.id === cancelled.id,
    ),
  ).toBe(false);
  expect(
    (
      await req(
        "/admin/announcements/" + a.id,
        root.sessionToken,
        draft(),
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await req(
        "/admin/announcements",
        root.sessionToken,
        draft({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      )
    ).status,
  ).toBe(400);
});
test("a persisted due schedule recovers after application restart", async () => {
  const now = Date.now(),
    a = await create({
      startsAt: new Date(now + 800).toISOString(),
      expiresAt: new Date(now + 6000).toISOString(),
    });
  await req("/admin/announcements/" + a.id + "/publish", root.sessionToken, {});
  await app.close();
  await Bun.sleep(1000);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  let state: string | undefined;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    state = (await req("/announcements")).body.items.find(
      (p: { id: string }) => p.id === a.id,
    )?.state;
    if (state === "active") break;
    await Bun.sleep(25);
  }
  expect(state).toBe("active");
});
