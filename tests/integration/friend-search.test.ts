import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { hash } from "../../apps/api/src/context";
import { createApp } from "../../apps/api/src/app";
import { createDatabase, users, credentials } from "@cinegather/database";
import { inArray } from "drizzle-orm";

const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people = Array.from({ length: 4 }, (_, index) => ({
  id: randomUUID(),
  token: randomUUID(),
  username: `fs_${index}_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
}));
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
beforeAll(async () => {
  for (const [index, person] of people.entries()) {
    await db.insert(users).values({
      id: person.id,
      username: index === 3 ? null : person.username,
      displayName: index === 3 ? person.username : "同名昵称",
      passwordHash: index === 3 ? null : "fixture-unused-password",
      disabledAt: index === 2 ? new Date() : null,
    });
  }
  await db.insert(credentials).values({
    id: randomUUID(),
    userId: people[0]!.id,
    kind: "account",
    secretHash: hash(people[0]!.token),
    expiresAt: new Date(Date.now() + 3600_000),
  });
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  const ids = people.map((p) => p.id);
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});
async function search(username: string, authenticated = true) {
  const response = await fetch(
    `${base}/api/v1/friends/search?username=${encodeURIComponent(username)}`,
    {
      headers: authenticated
        ? { Authorization: `Bearer ${people[0]!.token}` }
        : {},
    },
  );
  return { status: response.status, body: await response.json() };
}
test("friend search requires login and returns only the exact normalized account identity", async () => {
  expect((await search(people[1]!.username, false)).status).toBe(401);
  const found = await search(` ${people[1]!.username.toUpperCase()} `);
  expect(found.status).toBe(200);
  expect(found.body).toEqual({
    user: {
      userId: people[1]!.id,
      username: people[1]!.username,
      displayName: "同名昵称",
    },
  });
  expect((await search(people[1]!.username.slice(0, -2))).body).toEqual({
    user: null,
  });
});
test("friend search hides self, disabled and legacy users and validates the username", async () => {
  for (const index of [0, 2, 3])
    expect((await search(people[index]!.username)).body).toEqual({
      user: null,
    });
  for (const invalid of ["", "ab", "a".repeat(33), "同名昵称", "%_"])
    expect((await search(invalid)).status).toBe(400);
});
