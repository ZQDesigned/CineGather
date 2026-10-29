import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { hash } from "../../apps/api/src/context";
import {
  createDatabase,
  users,
  credentials,
  friendships,
  auditLogs,
} from "@cinegather/database";
import { inArray, or } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people = Array.from({ length: 4 }, (_, index) => ({
  id: randomUUID(),
  token: randomUUID(),
  username: "fp_" + randomUUID().replaceAll("-", "").slice(0, 20),
  displayName: "原昵称" + index,
}));
let app: Awaited<ReturnType<typeof createApp>>, base: string;
async function request(
  path: string,
  who = 0,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      ...(who >= 0 ? { Authorization: "Bearer " + people[who]!.token } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
const patch = (who: number, target: number, body: unknown) =>
  request(`/friends/${people[target]!.id}/preferences`, who, body, "PATCH");
const friend = async (who: number, target: number) =>
  (await request("/friends", who)).body.items.find(
    (f: { userId: string }) => f.userId === people[target]!.id,
  );
beforeAll(async () => {
  for (const p of people) {
    await db.insert(users).values({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      passwordHash: "fixture-unused",
    });
    await db.insert(credentials).values({
      id: randomUUID(),
      userId: p.id,
      kind: "account",
      secretHash: hash(p.token),
      expiresAt: new Date(Date.now() + 3600000),
    });
  }
  await db.insert(friendships).values(
    [1, 2, 3].map((i) => ({
      requesterId: people[0]!.id,
      recipientId: people[i]!.id,
      status: i === 3 ? "pending" : "accepted",
    })),
  );
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  const ids = people.map((p) => p.id);
  await db
    .delete(friendships)
    .where(
      or(
        inArray(friendships.requesterId, ids),
        inArray(friendships.recipientId, ids),
      ),
    );
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});
test("remarks and pins are private to each side and never replace public account names", async () => {
  expect(
    (await patch(0, 1, { remark: "  老朋友  ", pinned: true })).status,
  ).toBe(200);
  expect(await friend(0, 1)).toMatchObject({
    remark: "老朋友",
    pinned: true,
    displayName: "原昵称1",
  });
  expect(await friend(1, 0)).toMatchObject({
    remark: "",
    pinned: false,
    displayName: "原昵称0",
  });
  expect(
    (await patch(1, 0, { remark: "另一侧的备注", pinned: true })).status,
  ).toBe(200);
  expect(await friend(0, 1)).toMatchObject({ remark: "老朋友", pinned: true });
  const found = await request(
    `/friends/search?username=${people[1]!.username}`,
  );
  expect(found.body.user.displayName).toBe("原昵称1");
  expect(JSON.stringify(found.body)).not.toContain("老朋友");
});
test("only authenticated accepted friends can update their own preferences and inputs are bounded", async () => {
  expect((await patch(-1, 1, { pinned: true })).status).toBe(401);
  expect((await patch(0, 3, { pinned: true })).status).toBe(403);
  expect((await patch(2, 1, { remark: "not my friend" })).status).toBe(403);
  for (const body of [
    {},
    { remark: "x".repeat(51) },
    { remark: null },
    { pinned: "yes" },
    { remark: "x", requesterId: people[1]!.id },
  ])
    expect((await patch(0, 1, body)).status).toBe(400);
  expect(await friend(1, 0)).toMatchObject({
    remark: "另一侧的备注",
    pinned: true,
  });
});
test("pins sort ahead of ordinary friends and repeating pin does not change its position", async () => {
  await patch(0, 1, { pinned: false });
  await patch(0, 2, { pinned: false });
  await patch(0, 1, { pinned: true });
  await patch(0, 2, { pinned: true });
  const first = async () =>
    (await request("/friends")).body.items
      .slice(0, 2)
      .map((f: { userId: string }) => f.userId);
  expect(await first()).toEqual([people[2]!.id, people[1]!.id]);
  await patch(0, 1, { pinned: true });
  expect(await first()).toEqual([people[2]!.id, people[1]!.id]);
  await patch(0, 2, { pinned: false });
  expect((await first())[0]).toBe(people[1]!.id);
});
test("partial concurrent updates preserve both fields and clearing a remark keeps pinning", async () => {
  const results = await Promise.all([
    patch(0, 1, { remark: "并发备注" }),
    patch(0, 1, { pinned: true }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(await friend(0, 1)).toMatchObject({
    remark: "并发备注",
    pinned: true,
  });
  await patch(0, 1, { remark: "  " });
  expect(await friend(0, 1)).toMatchObject({ remark: "", pinned: true });
});
test("removing and re-adding a friendship removes both sides' remarks and pins", async () => {
  expect(
    (await request(`/friends/${people[1]!.id}`, 0, undefined, "DELETE")).status,
  ).toBe(200);
  await request("/friends", 0, { userId: people[1]!.id });
  await request(`/friends/${people[0]!.id}/accept`, 1, {});
  expect(await friend(0, 1)).toMatchObject({ remark: "", pinned: false });
  expect(await friend(1, 0)).toMatchObject({ remark: "", pinned: false });
});

test("browser preflight permits the authenticated partial preference update", async () => {
  const response = await fetch(
    base + `/api/v1/friends/${people[1]!.id}/preferences`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    },
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-methods")).toContain(
    "PATCH",
  );
});
