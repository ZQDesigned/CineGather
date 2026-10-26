import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { hash } from "../../apps/api/src/context";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  credentials,
  friendships,
  users,
} from "@cinegather/database";
import { eq, inArray, sql } from "drizzle-orm";

const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const identities: { id: string; token: string; credential: string }[] = [];
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
async function request(path: string, index: number, body?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${identities[index]!.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
const friend = async (index: number) =>
  (await request("/friends", 0)).body.items.find(
    (f: { userId: string }) => f.userId === identities[index]!.id,
  );
beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const id = randomUUID(),
      token = randomUUID(),
      credential = randomUUID();
    identities.push({ id, token, credential });
    await db.insert(users).values({
      id,
      username: `pr_${id.replaceAll("-", "").slice(0, 20)}`,
      passwordHash: "fixture-unused-password",
      displayName: `在线测试${i}`,
    });
    await db.insert(credentials).values({
      id: credential,
      userId: id,
      kind: "account",
      secretHash: hash(token),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }
  await db.insert(friendships).values([
    {
      requesterId: identities[0]!.id,
      recipientId: identities[1]!.id,
      status: "accepted",
    },
    {
      requesterId: identities[0]!.id,
      recipientId: identities[2]!.id,
      status: "pending",
    },
  ]);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  const ids = identities.map((i) => i.id);
  await db.delete(friendships).where(inArray(friendships.requesterId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});

test("only a live accepted friend is online; invisible preference persists across sessions", async () => {
  expect((await friend(1)).online).toBe(false);
  expect((await request("/presence/heartbeat", 1, {})).status).toBe(201);
  expect((await friend(1)).online).toBe(true);
  expect(
    (await request("/presence", 1, { visibility: "invisible" })).body
      .visibility,
  ).toBe("invisible");
  expect((await friend(1)).online).toBe(false);
  expect((await request("/presence/heartbeat", 1, {})).body.visibility).toBe(
    "invisible",
  );
  expect((await friend(1)).online).toBe(false);
  expect(
    (await request("/presence", 1, { visibility: "online" })).body.visibility,
  ).toBe("online");
  expect((await friend(1)).online).toBe(true);
  await request("/presence/heartbeat", 2, {});
  expect((await friend(2)).online).toBe(false);
  expect(await friend(1)).not.toHaveProperty("lastSeenAt");
});

test("legacy clients become online through authenticated activity without exposing an invisible user", async () => {
  const identity = identities[1]!;
  await db.execute(
    sql`UPDATE user_credentials SET presence_at = NOW() - INTERVAL '3 minutes' WHERE id = ${identity.credential}`,
  );
  expect((await friend(1)).online).toBe(false);
  expect((await request("/me", 1)).status).toBe(200);
  expect((await friend(1)).online).toBe(true);
  await request("/presence", 1, { visibility: "invisible" });
  await request("/me", 1);
  expect((await friend(1)).online).toBe(false);
  await request("/presence", 1, { visibility: "online" });
});

test("expired heartbeat, revoked credentials and disabled accounts appear offline", async () => {
  await db.execute(
    sql`UPDATE user_credentials SET presence_at = NOW() - INTERVAL '3 minutes' WHERE id = ${identities[1]!.credential}`,
  );
  expect((await friend(1)).online).toBe(false);
  await request("/presence/heartbeat", 1, {});
  expect((await friend(1)).online).toBe(true);
  await db
    .update(credentials)
    .set({ revokedAt: new Date() })
    .where(eq(credentials.id, identities[1]!.credential));
  expect((await friend(1)).online).toBe(false);
  expect((await request("/presence/heartbeat", 1, {})).status).toBe(401);
  await db
    .update(credentials)
    .set({ revokedAt: null })
    .where(eq(credentials.id, identities[1]!.credential));
  await db
    .update(users)
    .set({ disabledAt: new Date() })
    .where(eq(users.id, identities[1]!.id));
  expect((await friend(1)).online).toBe(false);
});

test("one expired device does not hide another live device; invisibility applies to both", async () => {
  const identity = identities[1]!;
  await db
    .update(users)
    .set({ disabledAt: null })
    .where(eq(users.id, identity.id));
  await request("/presence/heartbeat", 1, {});
  const second = randomUUID();
  await db.insert(credentials).values({
    id: second,
    userId: identity.id,
    kind: "account",
    secretHash: hash(randomUUID()),
    presenceAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
  });
  await db
    .update(credentials)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(credentials.id, identity.credential));
  expect((await friend(1)).online).toBe(true);
  await db
    .update(users)
    .set({ presenceVisibility: "invisible" })
    .where(eq(users.id, identity.id));
  expect((await friend(1)).online).toBe(false);
  await db
    .update(users)
    .set({ presenceVisibility: "online" })
    .where(eq(users.id, identity.id));
  await db
    .update(credentials)
    .set({ revokedAt: new Date() })
    .where(eq(credentials.id, second));
  expect((await friend(1)).online).toBe(false);
});

test("presence changes reject forged users and invalid values", async () => {
  expect(
    (
      await request("/presence", 0, {
        visibility: "online",
        userId: identities[2]!.id,
      })
    ).status,
  ).toBe(400);
  expect(
    (await request("/presence", 0, { visibility: "offline" })).status,
  ).toBe(400);
  expect(
    (await fetch(`${base}/api/v1/presence/heartbeat`, { method: "POST" }))
      .status,
  ).toBe(401);
});
