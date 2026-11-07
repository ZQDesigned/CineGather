import { beforeAll, afterAll, test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/core/context";
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
import { activePartyWords } from "../../apps/api/src/modules/party/party-bank";
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
  await db.insert(users).values({
    id,
    username: "bank_" + id.slice(0, 8),
    passwordHash: "fixture",
    displayName: "题库验证",
    isSuperAdmin: superadmin,
  });
  await db.insert(credentials).values({
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
  const pool = await activePartyWords(db, "draw");
  expect(pool.length).toBeGreaterThanOrEqual(400);
  expect(pool.some((w) => w.answer === prefix + "已有")).toBe(false);
  expect(pool.some((w) => w.answer === prefix + "甲")).toBe(false);
  await expect(
    db.transaction(async (tx) => {
      await tx.update(partyWordBank).set({ enabled: false });
      await activePartyWords(tx, "draw");
    }),
  ).rejects.toThrow("启用题目不足");
  expect((await activePartyWords(db, "draw")).length).toBeGreaterThanOrEqual(
    400,
  );
});

test("bulk preview accepts a valid 400-question payload above the normal API body limit", async () => {
  const input = {
    format: "json",
    content: JSON.stringify(
      Array.from({ length: 400 }, (_, i) => word("批量导入验证" + i)),
    ),
  };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(65536);
  const result = await call(root, "/import/preview", input);
  expect(result.status).toBe(201);
  expect(result.data).toMatchObject({
    createCount: 400,
    skipCount: 0,
    errors: [],
  });
});

test("mode-filtered administration and draw/quiz pools honor targeting and older edits retain it", async () => {
  const q = word("仅猜词");
  const created = await call(root, "", { ...q, modes: ["quiz"] });
  expect(created.status).toBe(201);
  expect(created.data.modes).toEqual(["quiz"]);
  expect(
    (await call(reader, "?q=" + encodeURIComponent(q.answer) + "&mode=draw"))
      .data.total,
  ).toBe(0);
  expect(
    (await call(reader, "?q=" + encodeURIComponent(q.answer) + "&mode=quiz"))
      .data.total,
  ).toBe(1);
  expect(
    (await activePartyWords(db, "draw")).some((w) => w.answer === q.answer),
  ).toBe(false);
  expect(
    (await activePartyWords(db, "quiz")).some((w) => w.answer === q.answer),
  ).toBe(true);
  const edited = await call(
    root,
    "/" + created.data.id,
    { ...q, category: "新分类", version: 1 },
    "PATCH",
  );
  expect(edited.status).toBe(200);
  expect(edited.data.modes).toEqual(["quiz"]);
  expect((await call(root, "", { ...word("空玩法"), modes: [] })).status).toBe(
    400,
  );
});

test("expansion migration can be replayed without replacing administrator content, modes or disabled status", async () => {
  const { sql } = await import("drizzle-orm");
  const migration = await Bun.file(
    new URL(
      "../../packages/database/migrations/0032_party_word_expansion.sql",
      import.meta.url,
    ),
  ).text();
  await expect(
    db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.answer, "史蒂夫"));
      expect(row).toBeDefined();
      await tx
        .update(partyWordBank)
        .set({
          enabled: false,
          modes: ["quiz"],
          category: "管理员自定义",
          version: 99,
        })
        .where(eq(partyWordBank.id, row!.id));
      await tx.execute(sql.raw(migration));
      const [kept] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, row!.id));
      expect(kept).toMatchObject({
        enabled: false,
        modes: ["quiz"],
        category: "管理员自定义",
        version: 99,
      });
      throw Error("rollback migration replay test");
    }),
  ).rejects.toThrow("rollback migration replay test");
});

test("visual-mode refinement updates only unchanged authored rows and is idempotent", async () => {
  const { sql } = await import("drizzle-orm");
  const migration = await Bun.file(
    new URL(
      "../../packages/database/migrations/0033_party_word_visual_modes.sql",
      import.meta.url,
    ),
  ).text();
  await expect(
    db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.answer, "水星"));
      const [edited] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.answer, "冥王星"));
      await tx
        .update(partyWordBank)
        .set({ version: 1, modes: ["draw", "quiz"] })
        .where(eq(partyWordBank.id, target!.id));
      await tx
        .update(partyWordBank)
        .set({ version: 7, modes: ["draw"], enabled: false })
        .where(eq(partyWordBank.id, edited!.id));
      for (let i = 0; i < 2; i++) await tx.execute(sql.raw(migration));
      const [changed] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, target!.id));
      const [kept] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, edited!.id));
      expect(changed).toMatchObject({ version: 2, modes: ["quiz"] });
      expect(kept).toMatchObject({
        version: 7,
        modes: ["draw"],
        enabled: false,
      });
      throw Error("rollback visual refinement test");
    }),
  ).rejects.toThrow("rollback visual refinement test");
});

test("modern game migration installs authored content and preserves admin changes on replay", async () => {
  const { sql } = await import("drizzle-orm");
  const { partyModernGameWords } = await import(
    "../../apps/api/src/modules/party/data/party-modern-game-words"
  );
  const migration = await Bun.file(
    new URL(
      "../../packages/database/migrations/0034_party_modern_game_words.sql",
      import.meta.url,
    ),
  ).text();
  const rows = await db
    .select()
    .from(partyWordBank)
    .where(
      inArray(
        partyWordBank.answer,
        partyModernGameWords.map((w) => w.answer),
      ),
    );
  expect(rows).toHaveLength(150);
  for (const authored of partyModernGameWords) {
    expect(rows.find((r) => r.answer === authored.answer)).toMatchObject({
      ...authored,
      enabled: true,
    });
  }
  await expect(
    db.transaction(async (tx) => {
      const target = rows.find((r) => r.answer === "阿米娅")!;
      const missing = rows.find((r) => r.answer === "可莉")!;
      await tx
        .update(partyWordBank)
        .set({
          category: "管理员保留分类",
          clues: ["管理员线索一", "管理员线索二", "管理员线索三"],
          modes: ["quiz"],
          enabled: false,
          version: 12,
        })
        .where(eq(partyWordBank.id, target.id));
      await tx.delete(partyWordBank).where(eq(partyWordBank.id, missing.id));
      for (let i = 0; i < 2; i++) await tx.execute(sql.raw(migration));
      const [kept] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, target.id));
      expect(kept).toMatchObject({
        category: "管理员保留分类",
        clues: ["管理员线索一", "管理员线索二", "管理员线索三"],
        modes: ["quiz"],
        enabled: false,
        version: 12,
      });
      const restored = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.answer, missing.answer));
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({
        ...partyModernGameWords.find((w) => w.answer === missing.answer)!,
        enabled: true,
      });
      throw Error("rollback modern game migration test");
    }),
  ).rejects.toThrow("rollback modern game migration test");
});
