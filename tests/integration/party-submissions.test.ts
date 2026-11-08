import { beforeAll, afterAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/core/context";
import {
  activePartyWords,
  savePartyWord,
} from "../../apps/api/src/modules/party/party-bank";
import { recordFirstCorrect } from "../../apps/api/src/modules/party/party-learning";
import {
  users,
  credentials,
  adminRoles,
  userRoles,
  auditLogs,
  partySubmissions,
  partyWordBank,
  partyCategories,
  partyFirstCorrect,
  rooms,
  members,
  roomSessions,
  leases,
  roomActivities,
} from "@cinegather/database";
import { protocolHeaders } from "@cinegather/contracts";

let app: Awaited<ReturnType<typeof createApp>>, origin: string;
const people: string[] = [],
  published: string[] = [],
  roomIds: string[] = [],
  roleIds: string[] = [];
async function person(correct = 50, days = 8, review = false) {
  const id = crypto.randomUUID(),
    token = crypto.randomUUID(),
    credentialId = crypto.randomUUID();
  people.push(id);
  await db.insert(users).values({
    id,
    username: "submission_" + id.slice(0, 8),
    displayName: "投稿用户",
    passwordHash: "fixture",
    createdAt: new Date(Date.now() - days * 86_400_000),
  });
  await db.insert(credentials).values({
    id: credentialId,
    userId: id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  if (correct)
    await db.insert(partyFirstCorrect).values(
      Array.from({ length: correct }, (_, i) => ({
        userId: id,
        answerKey: "资格已答" + i,
      })),
    );
  if (review) {
    const rid = crypto.randomUUID();
    roleIds.push(rid);
    await db.insert(adminRoles).values({
      id: rid,
      name: "审核员" + rid.slice(0, 8),
      permissions: ["party-submissions.read", "party-submissions.review"],
    });
    await db.insert(userRoles).values({ userId: id, roleId: rid });
  }
  return { id, token, credentialId };
}
type Person = Awaited<ReturnType<typeof person>>;
async function call(
  who: Person,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + who.token,
      "Content-Type": "application/json",
      ...protocolHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
let author: Person, other: Person, reviewer: Person, categoryId: string;
const draft = () => ({
  answer: "投稿" + crypto.randomUUID().slice(0, 8),
  categoryId,
  clues: ["第一条独特提示", "第二条具体提示", "第三条识别提示"],
  modes: ["draw", "quiz"] as ("draw" | "quiz")[],
});
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("activities_tests"))
    throw Error("isolated database required");
  author = await person();
  other = await person();
  reviewer = await person(0, 0, true);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
  const c = await call(author, "/party-submissions/catalog");
  categoryId = c.data.categories.find(
    (c: { name: string; parentId: string | null }) =>
      c.name === "用品" && !c.parentId,
  ).id;
});
afterAll(async () => {
  await app?.close();
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, people));
  await db
    .delete(partySubmissions)
    .where(inArray(partySubmissions.userId, people));
  if (published.length)
    await db.delete(partyWordBank).where(inArray(partyWordBank.id, published));
  if (roomIds.length) await db.delete(rooms).where(inArray(rooms.id, roomIds));
  await db.delete(users).where(inArray(users.id, people));
  if (roleIds.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roleIds));
});
test("submission eligibility is authoritative, normalized and rollback safe; no capability or admin bypass", async () => {
  expect(
    (await call(author, "/party-submissions/eligibility")).data,
  ).toMatchObject({ eligible: true, firstTryCorrect: 50 });
  for (const p of [await person(49), await person(50, 6), reviewer])
    expect((await call(p, "/party-submissions", draft())).status).toBe(403);
  const p = await person(0);
  await db.transaction(async (tx) => {
    await recordFirstCorrect(tx, p.id, " Ａ B ");
    await recordFirstCorrect(tx, p.id, "ab");
  });
  expect(
    (await call(p, "/party-submissions/eligibility")).data.firstTryCorrect,
  ).toBe(1);
  await expect(
    db.transaction(async (tx) => {
      await recordFirstCorrect(tx, p.id, "不应计入");
      throw Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(
    (await call(p, "/party-submissions/eligibility")).data.firstTryCorrect,
  ).toBe(1);
  expect(
    (
      await call(author, "/party-submissions", {
        ...draft(),
        author: { displayName: "冒名" },
      })
    ).status,
  ).toBe(400);
});
test("owners can edit, withdraw and resubmit while ownership, duplicate and version checks stay enforced", async () => {
  const input = draft();
  const created = await call(author, "/party-submissions", input);
  expect(created.status).toBe(201);
  const id = created.data.id;
  expect((await call(other, "/party-submissions/" + id)).status).toBe(404);
  expect(
    (
      await call(
        other,
        "/party-submissions/" + id,
        { ...input, version: 1 },
        "PATCH",
      )
    ).status,
  ).toBe(404);
  expect((await call(other, "/party-submissions", input)).status).toBe(409);
  expect(
    (
      await call(
        author,
        "/party-submissions/" + id,
        { ...input, version: 9 },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  const edited = await call(
    author,
    "/party-submissions/" + id,
    { ...input, clues: ["新的第一提示", "第二提示", "第三提示"], version: 1 },
    "PATCH",
  );
  expect(edited.data.version).toBe(2);
  const withdrawn = await call(
    author,
    "/party-submissions/" + id + "/withdraw",
    { version: 2 },
  );
  expect(withdrawn.data.status).toBe("withdrawn");
  const again = await call(
    author,
    "/party-submissions/" + id,
    { ...input, version: withdrawn.data.version },
    "PATCH",
  );
  expect(again.data.status).toBe("pending");
  expect((await call(author, "/admin/party-submissions")).status).toBe(403);
  expect((await call(reviewer, "/admin/party-words")).status).toBe(403);
  expect(
    (await call(reviewer, "/admin/party-submissions")).data.items.some(
      (s: { id: string }) => s.id === id,
    ),
  ).toBe(true);
});
test("review preserves the original author and manuscript, atomically publishes only once, and reports rejection reasons", async () => {
  const input = draft(),
    s = (await call(author, "/party-submissions", input)).data;
  expect(
    (
      await call(author, "/admin/party-submissions/" + s.id + "/review", {
        version: 1,
        decision: "approve",
      })
    ).status,
  ).toBe(403);
  const edited = {
    ...input,
    clues: ["审核调整第一提示", ...input.clues.slice(1)],
  };
  const decisions = await Promise.all(
    [0, 1].map(() =>
      call(reviewer, "/admin/party-submissions/" + s.id + "/review", {
        version: 1,
        decision: "approve",
        draft: edited,
      }),
    ),
  );
  expect(decisions.map((r) => r.status).sort()).toEqual([201, 409]);
  const accepted = decisions.find((r) => r.status === 201)!.data;
  published.push(accepted.wordId);
  expect(accepted.draft).toEqual(input);
  expect(accepted.reviewedDraft).toEqual(edited);
  expect(accepted.author.displayName).toBe("投稿用户");
  expect(
    (
      await call(
        author,
        "/party-submissions/" + s.id,
        { ...input, version: accepted.version },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect((await call(other, "/party-submissions", edited)).status).toBe(409);
  await db
    .update(users)
    .set({ displayName: "改名后的投稿人" })
    .where(eq(users.id, author.id));
  expect(
    (await call(author, "/party-submissions/" + s.id)).data.author.displayName,
  ).toBe("改名后的投稿人");
  const [word] = await db
    .select()
    .from(partyWordBank)
    .where(eq(partyWordBank.id, accepted.wordId));
  expect(word!.authorUserId).toBe(author.id);
  expect(word!.clues).toEqual(edited.clues);
  const rejected = (await call(author, "/party-submissions", draft())).data;
  expect(
    (
      await call(
        reviewer,
        "/admin/party-submissions/" + rejected.id + "/review",
        { version: 1, decision: "reject", reason: "" },
      )
    ).status,
  ).toBe(400);
  const refused = await call(
    reviewer,
    "/admin/party-submissions/" + rejected.id + "/review",
    { version: 1, decision: "reject", reason: "提示不够明确" },
  );
  expect(refused.data.reason).toBe("提示不够明确");
  const role = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, reviewer.id));
  await db.delete(userRoles).where(eq(userRoles.userId, reviewer.id));
  expect(
    (
      await call(
        reviewer,
        "/admin/party-submissions/" + rejected.id + "/review",
        { version: refused.data.version, decision: "approve" },
      )
    ).status,
  ).toBe(403);
  await db.insert(userRoles).values(role);
});
test("real room guesses count first tries in the activity transaction, not guesses after an error", async () => {
  const a = await person(0),
    b = await person(0),
    id = crypto.randomUUID();
  roomIds.push(id);
  await db.insert(rooms).values({
    id,
    code: id.replaceAll("-", "").slice(0, 8).toUpperCase(),
    name: "投稿资格验证",
    ownerUserId: a.id,
    maxMembers: 5,
  });
  await db.insert(leases).values({ roomId: id });
  for (const p of [a, b]) {
    await db.insert(members).values({
      roomId: id,
      userId: p.id,
      role: p.id === a.id ? "owner" : "member",
      admittedUntil: new Date(Date.now() + 120000),
    });
    await db.insert(roomSessions).values({
      roomId: id,
      userId: p.id,
      credentialId: p.credentialId,
      admittedUntil: new Date(Date.now() + 120000),
    });
  }
  const path = "/rooms/" + id + "/activity";
  let s = (
    await call(a, path, { type: "start", target: "quiz", generation: 0 })
  ).data;
  for (const p of [a, b])
    await call(p, path, {
      type: "party",
      generation: s.generation,
      action: { type: "ready", ready: true },
    });
  s = (
    await call(a, path, {
      type: "party",
      generation: s.generation,
      action: { type: "start" },
    })
  ).data;
  const [state] = await db
    .select()
    .from(roomActivities)
    .where(eq(roomActivities.roomId, id));
  const answer = (state!.state as { game: { word: { answer: string } } }).game
    .word.answer;
  expect(
    (
      await call(other, path, {
        type: "party",
        generation: s.generation,
        action: { type: "guess", answer },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(a, path, {
        type: "party",
        generation: s.generation,
        action: { type: "guess", answer },
      })
    ).status,
  ).toBe(201);
  expect(
    (await call(a, "/party-submissions/eligibility")).data.firstTryCorrect,
  ).toBe(1);
  await call(b, path, {
    type: "party",
    generation: s.generation,
    action: { type: "guess", answer: "不可能的错误答案" },
  });
  await new Promise((r) => setTimeout(r, 850));
  await call(b, path, {
    type: "party",
    generation: s.generation,
    action: { type: "guess", answer },
  });
  expect(
    (await call(b, "/party-submissions/eligibility")).data.firstTryCorrect,
  ).toBe(0);
  expect(
    (await call(other, "/party-submissions/eligibility")).data.firstTryCorrect,
  ).toBe(50);
});

test("submission approval revalidates disabled categories and intervening official duplicates without overwriting the queue", async () => {
  const category = crypto.randomUUID();
  await db.insert(partyCategories).values({
    id: category,
    name: "投稿验证" + category.slice(0, 8),
    nameKey: "投稿验证" + category,
  });
  const input = { ...draft(), categoryId: category },
    s = (await call(author, "/party-submissions", input)).data;
  await db
    .update(partyCategories)
    .set({ enabled: false })
    .where(eq(partyCategories.id, category));
  expect(
    (
      await call(reviewer, `/admin/party-submissions/${s.id}/review`, {
        decision: "approve",
        version: 1,
      })
    ).status,
  ).toBe(409);
  expect((await call(author, `/party-submissions/${s.id}`)).data).toMatchObject(
    { status: "pending", version: 1 },
  );
  await db
    .update(partyCategories)
    .set({ enabled: true })
    .where(eq(partyCategories.id, category));
  const wordId = crypto.randomUUID();
  published.push(wordId);
  await db.insert(partyWordBank).values({
    id: wordId,
    answer: input.answer,
    answerKey: input.answer.toLowerCase(),
    clues: input.clues,
    category: "用品",
    categoryId,
    modes: ["draw"],
    enabled: false,
  });
  expect(
    (
      await call(reviewer, `/admin/party-submissions/${s.id}/review`, {
        decision: "approve",
        version: 1,
      })
    ).status,
  ).toBe(409);
  expect((await call(author, `/party-submissions/${s.id}`)).data.status).toBe(
    "pending",
  );
  await db.delete(partySubmissions).where(eq(partySubmissions.id, s.id));
  await db.delete(partyCategories).where(eq(partyCategories.id, category));
});
test("attribution follows renames for new pools, survives edits and account deletion, and never puts usernames in public words", async () => {
  const p = await person(),
    input = draft(),
    s = (await call(p, "/party-submissions", input)).data;
  const result = await call(
    reviewer,
    `/admin/party-submissions/${s.id}/review`,
    { decision: "approve", version: 1 },
  );
  expect(result.status).toBe(201);
  published.push(result.data.wordId);
  const before = await activePartyWords(db, "draw"),
    old = before.find((w) => w.answer === input.answer)!;
  expect(old.author).toEqual({ displayName: "投稿用户" });
  await db
    .update(users)
    .set({ displayName: "新的作者昵称" })
    .where(eq(users.id, p.id));
  expect(
    (await activePartyWords(db, "draw")).find((w) => w.answer === input.answer)
      ?.author,
  ).toEqual({ displayName: "新的作者昵称" });
  expect(old.author?.displayName).toBe("投稿用户");
  expect(JSON.stringify(old)).not.toContain("username");
  const root = await person(0, 0);
  await db
    .update(users)
    .set({ isSuperAdmin: true })
    .where(eq(users.id, root.id));
  const actor = { id: root.id, displayName: "题库管理员" };
  const saved = await savePartyWord(
    actor,
    {
      ...input,
      category: "用品",
      enabled: true,
      clues: ["保留作者的修改", "第二提示", "第三提示"],
    },
    result.data.wordId,
    1,
  );
  expect(saved.submitter?.displayName).toBe("新的作者昵称");
  await db.delete(auditLogs).where(eq(auditLogs.actorId, p.id));
  await db.delete(users).where(eq(users.id, p.id));
  const fallback = await call(reviewer, `/admin/party-submissions/${s.id}`);
  expect(fallback.data.author).toMatchObject({
    displayName: "投稿用户",
    username: "submission_" + p.id.slice(0, 8),
  });
  expect(
    (await activePartyWords(db, "draw")).find((w) => w.answer === input.answer)
      ?.author,
  ).toEqual({ displayName: "投稿用户" });
  await db.delete(partySubmissions).where(eq(partySubmissions.id, s.id));
});
