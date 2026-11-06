import { beforeAll, afterAll, test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/context";
import {
  users,
  credentials,
  adminRoles,
  userRoles,
  partyWordBank,
  auditLogs,
} from "@cinegather/database";
import { eq, inArray, like } from "drizzle-orm";
import { protocolHeaders } from "@cinegather/contracts";
import { activePartyWords } from "../../apps/api/src/party-bank";
const prefix = "验题" + crypto.randomUUID().slice(0, 8),
  ids: string[] = [],
  roleIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
  root: string,
  reader: string,
  normal: string;
async function person(superadmin = false, readOnly = false) {
  const id = crypto.randomUUID(),
    token = crypto.randomUUID();
  ids.push(id);
  await db
    .insert(users)
    .values({
      id,
      username: "bank_" + id.slice(0, 8),
      passwordHash: "fixture",
      displayName: "题库验证",
      isSuperAdmin: superadmin,
    });
  await db
    .insert(credentials)
    .values({
      id: crypto.randomUUID(),
      userId: id,
      kind: "account",
      secretHash: hash(token),
      expiresAt: new Date(Date.now() + 3600000),
    });
  if (readOnly) {
    const rid = crypto.randomUUID();
    roleIds.push(rid);
    await db
      .insert(adminRoles)
      .values({ id: rid, name: rid, permissions: ["party-words.read"] });
    await db.insert(userRoles).values({ userId: id, roleId: rid });
  }
  return token;
}
async function call(
  token: string,
  path = "",
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api/v1/admin/party-words" + path, {
    method,
    headers: {
      ...protocolHeaders,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
const word = (suffix: string) => ({
  answer: prefix + suffix,
  category: "验证分类",
  clues: ["第一条线索", "第二条线索", "第三条线索"],
  enabled: true,
});
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("activities_tests"))
    throw Error("isolated test database required");
  root = await person(true);
  reader = await person(false, true);
  normal = await person();
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await db
    .delete(partyWordBank)
    .where(like(partyWordBank.answer, prefix + "%"));
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  if (roleIds.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roleIds));
});
test("bank read and write authorization; CRUD with revision conflicts and audit", async () => {
  expect((await call(normal)).status).toBe(403);
  expect((await call(reader)).status).toBe(200);
  expect((await call(reader, "", word("无权"))).status).toBe(403);
  expect(
    (await call(normal, "/import/preview", { format: "json", content: "[]" }))
      .status,
  ).toBe(403);
  const created = await call(root, "", word("甲"));
  expect(created.status).toBe(201);
  const id = created.data.id;
  expect(
    (await call(root, "", { ...word("甲"), answer: prefix + " 甲" })).status,
  ).toBe(409);
  expect(
    (
      await call(
        root,
        "/" + id,
        { ...word("甲"), enabled: false, version: 1 },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect(
    (await call(root, "/" + id, { ...word("甲"), version: 1 }, "PATCH")).status,
  ).toBe(409);
  const list = await call(
    reader,
    "?q=" + encodeURIComponent(prefix) + "&status=disabled",
  );
  expect(
    list.data.items.find((w: { id: string }) => w.id === id)?.enabled,
  ).toBe(false);
  expect((await call(root, "/" + id + "/delete", { version: 1 })).status).toBe(
    409,
  );
  expect((await call(root, "/" + id + "/delete", { version: 2 })).status).toBe(
    201,
  );
  expect((await call(root, "/" + id + "/delete", { version: 2 })).status).toBe(
    404,
  );
  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, id));
  expect(audits.map((r) => r.action).sort()).toEqual([
    "admin.party_word_created",
    "admin.party_word_deleted",
    "admin.party_word_updated",
  ]);
});
test("preview and atomic import skip existing words without overriding edits", async () => {
  const created = await call(root, "", { ...word("已有"), enabled: false });
  expect(created.status).toBe(201);
  const invalid = {
    format: "json",
    content: JSON.stringify([word("不写入"), { answer: "bad" }]),
  };
  expect(
    (await call(root, "/import/preview", invalid)).data.errors,
  ).toHaveLength(1);
  expect((await call(root, "/import/commit", invalid)).status).toBe(400);
  expect(
    (await call(root, "?q=" + encodeURIComponent(prefix + "不写入"))).data
      .total,
  ).toBe(0);
  const valid = {
    format: "json",
    content: JSON.stringify([word("已有"), word("新增")]),
  };
  expect((await call(root, "/import/preview", valid)).data).toMatchObject({
    createCount: 1,
    skipCount: 1,
    errors: [],
  });
  const results = await Promise.all([
    call(root, "/import/commit", valid),
    call(root, "/import/commit", valid),
  ]);
  expect(results.every((r) => r.status === 201)).toBe(true);
  expect(results.map((r) => r.data.created).sort()).toEqual([0, 1]);
  const rows = (await call(root, "?q=" + encodeURIComponent(prefix))).data
    .items;
  expect(
    rows.filter((w: { answer: string }) => w.answer === prefix + "新增"),
  ).toHaveLength(1);
  expect(
    rows.find((w: { answer: string }) => w.answer === prefix + "已有").enabled,
  ).toBe(false);
});
test("enabled pool excludes stopped/deleted questions and rejects insufficient bank", async () => {
  const pool = await activePartyWords(db);
  expect(pool.length).toBeGreaterThanOrEqual(400);
  expect(pool.some((w) => w.answer === prefix + "已有")).toBe(false);
  expect(pool.some((w) => w.answer === prefix + "甲")).toBe(false);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(partyWordBank).set({ enabled: false });
      await activePartyWords(tx);
    }),
  ).rejects.toThrow("启用的题目不足");
  expect((await activePartyWords(db)).length).toBeGreaterThanOrEqual(400);
});
