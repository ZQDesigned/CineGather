import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  credentials,
  auditLogs,
} from "@cinegather/database";
import { inArray, sql } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const ids: string[] = [];
const prefix = `reg_${crypto.randomUUID().slice(0, 8)}`;
const password = "Registration fixture 123!";
let app: Awaited<ReturnType<typeof createApp>>, base: string;
let root: { user: { id: string }; sessionToken: string }, member: typeof root;
let previous: unknown[] = [];
async function req(path: string, token?: string, body?: unknown) {
  const r = await fetch(base + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
async function account(suffix: string) {
  const r = await req("/accounts/register", undefined, {
    username: prefix + "_" + suffix,
    displayName: "注册策略测试",
    password,
  });
  if (r.status === 201) ids.push(r.body.user.id);
  return r;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  root = (await account("root")).body;
  member = (await account("member")).body;
  expect(root.user.id).toBeDefined();
  await db.execute(
    sql`UPDATE users SET is_super_admin=true WHERE id=${root.user.id}`,
  );
});
afterAll(async () => {
  await app?.close();
  if (previous.length) {
    await db.execute(sql`DELETE FROM registration_policy`);
    for (const row of previous as { enabled: boolean }[])
      await db.execute(
        sql`INSERT INTO registration_policy(id,enabled) VALUES(1,${row.enabled})`,
      );
  } else await db.execute(sql`DELETE FROM registration_policy`).catch(() => {});
  if (ids.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
});
test("closed registration rejects valid direct requests without creating users, while existing login works", async () => {
  const initial = await req("/admin/registration", root.sessionToken);
  expect(initial.status).toBe(200);
  previous = (await db.execute(sql`SELECT enabled FROM registration_policy`))
    .rows;
  const closed = await req("/admin/registration", root.sessionToken, {
    enabled: false,
    reason: "关闭测试注册",
  });
  expect(closed.status).toBe(201);
  expect(closed.body.enabled).toBe(false);
  expect((await req("/registration")).body).toEqual({ enabled: false });
  const denied = await account("blocked");
  expect(denied.status).toBe(403);
  expect(denied.body.code).toBe("REGISTRATION_CLOSED");
  expect(
    (
      await db.execute(
        sql`SELECT id FROM users WHERE username=${prefix + "_blocked"}`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await req("/accounts/login", undefined, {
        username: prefix + "_member",
        password,
      })
    ).status,
  ).toBe(201);
  const another = await createApp();
  await another.listen(0, "127.0.0.1");
  try {
    const r = await fetch((await another.getUrl()) + "/api/v1/registration");
    expect(await r.json()).toEqual({ enabled: false });
  } finally {
    await another.close();
  }
});
test("only superadmins may change registration and explicitly reopening permits signup with an audit trail", async () => {
  const roles = await req("/admin/roles", root.sessionToken);
  const role = roles.body.items.find((r: { builtIn: boolean }) => r.builtIn);
  expect(
    (
      await req(
        "/admin/users/" + member.user.id + "/roles",
        root.sessionToken,
        { roleIds: [role.id], reason: "验证普通管理员无权修改注册" },
      )
    ).status,
  ).toBe(201);
  expect((await req("/admin/registration")).status).toBe(401);
  expect((await req("/admin/registration", member.sessionToken)).status).toBe(
    403,
  );
  expect(
    (
      await req("/admin/registration", member.sessionToken, {
        enabled: true,
        reason: "无权开启",
      })
    ).status,
  ).toBe(403);
  expect((await req("/registration")).body.enabled).toBe(false);
  expect(
    (
      await req("/admin/registration", root.sessionToken, {
        enabled: true,
        reason: "",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await req("/admin/registration", root.sessionToken, {
        enabled: true,
        reason: "测试明确开放",
      })
    ).status,
  ).toBe(201);
  expect((await account("allowed")).status).toBe(201);
  const rows = (
    await db.execute(
      sql`SELECT details FROM audit_logs WHERE actor_id=${root.user.id} AND action='admin.registration_updated' ORDER BY created_at`,
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows[1]!.details).toMatchObject({
    enabled: true,
    reason: "测试明确开放",
  });
  await req("/admin/registration", root.sessionToken, {
    enabled: false,
    reason: "测试收尾关闭",
  });
  expect((await account("blocked_again")).status).toBe(403);
});

test("a registration racing a policy close cannot use an earlier open snapshot", async () => {
  await req("/admin/registration", root.sessionToken, {
    enabled: true,
    reason: "准备并发关闭测试",
  });
  const connection = await pool.connect();
  let pending: ReturnType<typeof account> | undefined;
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(839216)");
    await connection.query(
      "UPDATE registration_policy SET enabled=false WHERE id=1",
    );
    pending = account("racing");
    const early = await Promise.race([
      pending.then((r) => r.status),
      Bun.sleep(250).then(() => null),
    ]);
    expect(early).toBeNull();
    await connection.query("COMMIT");
    expect((await pending).status).toBe(403);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    await pending;
  }
});
