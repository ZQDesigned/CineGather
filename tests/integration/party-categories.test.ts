import { beforeAll, afterAll, test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/core/context";
import { users, credentials } from "@cinegather/database";
import { partyCatalogSchema, protocolHeaders } from "@cinegather/contracts";
let app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
  root: string,
  member: string;
async function person(superadmin: boolean) {
  const id = crypto.randomUUID(),
    token = crypto.randomUUID();
  await db.insert(users).values({
    id,
    username: "cat_" + id.slice(0, 8),
    passwordHash: "fixture",
    displayName: "分类验证",
    isSuperAdmin: superadmin,
  });
  await db.insert(credentials).values({
    id: crypto.randomUUID(),
    userId: id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return token;
}
async function call(
  path: string,
  body?: unknown,
  token = root,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api/v1/admin/" + path, {
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
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("activities_tests"))
    throw Error("isolated database required");
  root = await person(true);
  member = await person(false);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});
test("category hierarchy supports direct questions, optional children, protected deletion and policy revision", async () => {
  expect((await call("party-categories", undefined, member)).status).toBe(403);
  const name = "分类" + crypto.randomUUID().slice(0, 8);
  const a = await call("party-categories", {
    name,
    parentId: null,
    enabled: true,
    sortOrder: 0,
  });
  expect(a.status).toBe(201);
  const b = await call("party-categories", {
    name: "子类",
    parentId: a.data.id,
    enabled: true,
    sortOrder: 0,
  });
  expect(b.status).toBe(201);
  expect(
    (
      await call("party-categories", {
        name: "三级",
        parentId: b.data.id,
        enabled: true,
        sortOrder: 0,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call("party-categories", {
        name,
        parentId: null,
        enabled: true,
        sortOrder: 0,
      })
    ).status,
  ).toBe(409);
  const word = await call("party-words", {
    answer: name,
    category: name,
    categoryId: a.data.id,
    clues: ["提示一", "提示二", "提示三"],
    enabled: true,
  });
  expect(word.status).toBe(201);
  expect(
    (await call("party-categories/" + a.data.id + "/delete", { version: 1 }))
      .status,
  ).toBe(409);
  const cat = await call("party-categories");
  expect(cat.status).toBe(200);
  expect(partyCatalogSchema.safeParse(cat.data).success).toBe(true);
  expect(
    cat.data.categories.find((c: { id: string }) => c.id === a.data.id),
  ).toMatchObject({ drawCount: 1, quizCount: 1 });
  const p = cat.data.policy;
  const save = await call("party-categories/policy", {
    ...p,
    draw: { minQuestions: 20, minCategories: 2 },
  });
  expect(save.status).toBe(201);
  expect((await call("party-categories/policy", p)).status).toBe(409);
  const move = await call("party-categories/move-words", {
    categoryId: b.data.id,
    items: [{ id: word.data.id, version: 1 }],
  });
  expect(move.status).toBe(201);
  expect(
    (
      await call("party-categories/move-words", {
        categoryId: a.data.id,
        items: [{ id: word.data.id, version: 1 }],
      })
    ).status,
  ).toBe(409);
  const rename = await call(
    "party-categories/" + b.data.id,
    {
      name: "新子类",
      parentId: a.data.id,
      enabled: false,
      sortOrder: 0,
      version: 1,
    },
    root,
    "PATCH",
  );
  expect(rename.status).toBe(200);
  const words = await call("party-words?categoryId=" + b.data.id);
  expect(words.data.items[0]).toMatchObject({
    category: name + " / 新子类",
    categoryId: b.data.id,
    version: 2,
  });
  await call("party-categories/policy", { ...p, version: save.data.version });
});
