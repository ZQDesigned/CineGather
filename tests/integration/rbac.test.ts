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
let app: Awaited<ReturnType<typeof createApp>>, base: string;
const ids: string[] = [],
  roleIds: string[] = [];
const prefix = `rbac_${crypto.randomUUID().slice(0, 8)}`,
  password = "Roles fixture password 123!";
async function req(
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
async function account(label: string) {
  const r = await req("/accounts/register", undefined, {
    username: `${prefix}_${label}`,
    displayName: `角色测试${label}`,
    password,
  });
  expect(r.status).toBe(201);
  ids.push(r.body.user.id);
  return r.body;
}
let root: Awaited<ReturnType<typeof account>>,
  manager: Awaited<ReturnType<typeof account>>,
  member: Awaited<ReturnType<typeof account>>;
async function cli(command: string, id: string) {
  const child = Bun.spawn(["bun", "tools/superadmin.ts", command, id], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, error };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  root = await account("root");
  manager = await account("manager");
  member = await account("member");
  await db.execute(
    sql`UPDATE users SET is_super_admin=true WHERE id=${root.user.id}`,
  );
});
afterAll(async () => {
  await app?.close();
  if (roleIds.length)
    await db.execute(
      sql`DELETE FROM admin_roles WHERE id IN (${sql.join(
        roleIds.map((id) => sql`${id}::uuid`),
        sql`,`,
      )})`,
    );
  if (ids.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
});
test("superadmin grants normal administration through an actual role; ordinary administrators cannot delegate", async () => {
  const catalog = await req("/admin/roles", root.sessionToken);
  expect(catalog.status).toBe(200);
  const role = catalog.body.items.find((r: { builtIn: boolean }) => r.builtIn);
  expect(role.name).toBe("普通管理员");
  expect(
    (
      await req(`/admin/users/${manager.user.id}/roles`, root.sessionToken, {
        roleIds: [role.id],
        reason: "授予普通管理员",
      })
    ).status,
  ).toBe(201);
  const identity = (await req("/me", manager.sessionToken)).body;
  expect(identity.isSuperAdmin).toBe(false);
  expect(identity.roles[0].name).toBe("普通管理员");
  expect(identity.permissions).toContain("users.manage");
  expect((await req("/admin/users", manager.sessionToken)).status).toBe(200);
  expect((await req("/admin/roles", manager.sessionToken)).status).toBe(403);
  expect(
    (
      await req(`/admin/users/${member.user.id}/roles`, manager.sessionToken, {
        roleIds: [role.id],
        reason: "越权授权",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await req(
        `/admin/users/${manager.user.id}/disable`,
        manager.sessionToken,
        { reason: "不能管理同级账号" },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await req(`/admin/users/${root.user.id}/roles`, root.sessionToken, {
        roleIds: [],
        reason: "网页不能修改超管",
      })
    ).status,
  ).toBe(409);
});
test("custom roles have distinct server-enforced permissions and changes revoke access on existing sessions", async () => {
  const created = await req("/admin/roles", root.sessionToken, {
    name: `${prefix}审计员`,
    permissions: ["audit.read"],
    reason: "创建有限权限角色",
  });
  expect(created.status).toBe(201);
  roleIds.push(created.body.id);
  const id = created.body.id;
  expect(
    (
      await req(`/admin/users/${member.user.id}/roles`, root.sessionToken, {
        roleIds: [id],
        reason: "授予审计权限",
      })
    ).status,
  ).toBe(201);
  expect((await req("/admin/audit", member.sessionToken)).status).toBe(200);
  for (const path of [
    "/admin/overview",
    "/admin/users",
    "/ADMIN/rooms",
    "/admin/roles",
  ])
    expect((await req(path, member.sessionToken)).status).toBe(403);
  expect(
    (
      await req(
        `/admin/users/${manager.user.id}/disable`,
        member.sessionToken,
        { reason: "没有管理权限" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await req(`/admin/roles/${id}`, root.sessionToken, {
        name: `${prefix}房间查看`,
        permissions: ["rooms.read"],
        reason: "更改角色权限",
      })
    ).status,
  ).toBe(201);
  expect((await req("/admin/audit", member.sessionToken)).status).toBe(403);
  expect((await req("/admin/rooms", member.sessionToken)).status).toBe(200);
  expect(
    (
      await req(`/admin/roles/${id}/delete`, root.sessionToken, {
        reason: "已分配角色不可删除",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req(`/admin/users/${member.user.id}/roles`, root.sessionToken, {
        roleIds: [],
        reason: "撤销管理权限",
      })
    ).status,
  ).toBe(201);
  expect((await req("/admin/rooms", member.sessionToken)).status).toBe(403);
  expect((await req("/me", member.sessionToken)).status).toBe(200);
  expect(
    (
      await req(`/admin/roles/${id}/delete`, root.sessionToken, {
        reason: "删除未使用角色",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await req(`/admin/users/${member.user.id}/roles`, root.sessionToken, {
        roleIds: [id],
        reason: "不存在的角色",
      })
    ).status,
  ).toBe(400);
});
test("HTTP cannot set superadmin or inject undefined permissions; built-in role cannot be changed", async () => {
  expect(
    (
      await req("/accounts/register", undefined, {
        username: `${prefix}_forged`,
        displayName: "伪造",
        password,
        isSuperAdmin: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await req("/admin/roles", root.sessionToken, {
        name: "伪造超管角色",
        permissions: ["superadmin"],
        reason: "不应成功",
      })
    ).status,
  ).toBe(400);
  const roles = (await req("/admin/roles", root.sessionToken)).body.items;
  const builtin = roles.find((r: { builtIn: boolean }) => r.builtIn);
  expect(
    (
      await req(`/admin/roles/${builtin.id}`, root.sessionToken, {
        name: "篡改内置",
        permissions: ["audit.read"],
        reason: "不应成功",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req(`/admin/users/${manager.user.id}/roles`, root.sessionToken, {
        roleIds: [],
        reason: "伪造超管",
        isSuperAdmin: true,
      })
    ).status,
  ).toBe(400);
});
test("server CLI accepts user IDs only and superadmin changes affect existing sessions", async () => {
  expect((await cli("grant", member.user.username)).code).toBe(1);
  expect((await cli("grant", member.user.id)).code).toBe(0);
  expect((await req("/me", member.sessionToken)).body.isSuperAdmin).toBe(true);
  expect((await req("/admin/roles", member.sessionToken)).status).toBe(200);
  expect((await cli("revoke", member.user.id)).code).toBe(0);
  expect((await req("/admin/roles", member.sessionToken)).status).toBe(401);
});

test("role deletion and assignment cannot leave a dangling grant", async () => {
  const person = await account("race");
  const created = await req("/admin/roles", root.sessionToken, {
    name: `${prefix}并发审计`,
    permissions: ["audit.read"],
    reason: "并发验证",
  });
  expect(created.status).toBe(201);
  roleIds.push(created.body.id);
  const id = created.body.id;
  const [assigned, deleted] = await Promise.all([
    req(`/admin/users/${person.user.id}/roles`, root.sessionToken, {
      roleIds: [id],
      reason: "并发分配",
    }),
    req(`/admin/roles/${id}/delete`, root.sessionToken, { reason: "并发删除" }),
  ]);
  expect([
    [201, 409],
    [400, 201],
  ]).toContainEqual([assigned.status, deleted.status]);
  const access = (await req("/me", person.sessionToken)).body;
  expect(access.permissions.includes("audit.read")).toBe(
    assigned.status === 201,
  );
});
test("CLI refuses to remove the final superadmin, including two concurrent revocations", async () => {
  const schema = `rbac_cli_${crypto.randomUUID().replaceAll("-", "")}`;
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const isolated = new URL(process.env.DATABASE_URL!);
  isolated.searchParams.set("options", `-csearch_path=${schema}`);
  async function localCli(command: string, id: string) {
    const child = Bun.spawn(["bun", "tools/superadmin.ts", command, id], {
      env: { ...process.env, DATABASE_URL: isolated.toString() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, error] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    return { code, error };
  }
  await db.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
  try {
    for (const table of ["users", "user_credentials", "audit_logs"])
      await db.execute(
        sql`CREATE TABLE ${sql.identifier(schema)}.${sql.identifier(table)} (LIKE public.${sql.identifier(table)} INCLUDING ALL)`,
      );
    await db.execute(
      sql`INSERT INTO ${sql.identifier(schema)}.users (id,display_name,username,password_hash) VALUES (${a},'Root A','root_a','fixture_hash'),(${b},'Root B','root_b','fixture_hash')`,
    );
    expect((await localCli("grant", a)).code).toBe(0);
    const sole = await localCli("revoke", a);
    expect(sole.code).toBe(1);
    expect(sole.error).toContain("最后一位");
    expect((await localCli("grant", b)).code).toBe(0);
    const results = await Promise.all([
      localCli("revoke", a),
      localCli("revoke", b),
    ]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    const counted = await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(schema)}.users WHERE is_super_admin=true`,
    );
    expect(counted.rows[0]!.n).toBe(1);
  } finally {
    await db.execute(sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`);
  }
});

test("ordinary administrators may moderate normal users, while only superadmins may moderate ordinary admins", async () => {
  const normal = await account("moderated"),
    admin = await account("moderator");
  const builtin = (
    await req("/admin/roles", root.sessionToken)
  ).body.items.find((r: { builtIn: boolean }) => r.builtIn);
  await req(`/admin/users/${admin.user.id}/roles`, root.sessionToken, {
    roleIds: [builtin.id],
    reason: "分配管理角色用于层级验证",
  });
  expect(
    (
      await req(`/admin/users/${normal.user.id}/disable`, admin.sessionToken, {
        reason: "普通管理员管理用户",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", normal.sessionToken)).status).toBe(401);
  expect(
    (
      await req(`/admin/users/${admin.user.id}/disable`, manager.sessionToken, {
        reason: "不能管理同级",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req(`/admin/users/${admin.user.id}/disable`, root.sessionToken, {
        reason: "超管停用普通管理员",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", admin.sessionToken)).status).toBe(401);
  expect(
    (
      await req(`/admin/users/${admin.user.id}/enable`, root.sessionToken, {
        reason: "超管恢复普通管理员",
      })
    ).status,
  ).toBe(201);
});
