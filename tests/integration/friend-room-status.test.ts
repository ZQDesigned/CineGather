import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { hash } from "../../apps/api/src/context";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  credentials,
  friendships,
  users,
  rooms,
  members,
} from "@cinegather/database";
import { and, eq, inArray, or } from "drizzle-orm";

const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people = Array.from({ length: 4 }, () => ({
  id: randomUUID(),
  token: randomUUID(),
}));
const roomIds = [randomUUID(), randomUUID()];
let app: Awaited<ReturnType<typeof createApp>>, base: string;
async function friends() {
  const response = await fetch(base + "/api/v1/friends", {
    headers: { Authorization: `Bearer ${people[0]!.token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()).items as {
    userId: string;
    online: boolean;
    room: { memberCount: number; maxMembers: number } | null;
  }[];
}
const friend = async () =>
  (await friends()).find((item) => item.userId === people[1]!.id)!;
const admission = () => new Date(Date.now() + 120_000);
beforeAll(async () => {
  for (const [index, person] of people.entries()) {
    await db
      .insert(users)
      .values({
        id: person.id,
        username: "rs_" + person.id.replaceAll("-", "").slice(0, 20),
        displayName: `房间状态${index}`,
        passwordHash: "fixture-unused",
      });
    await db
      .insert(credentials)
      .values({
        id: randomUUID(),
        userId: person.id,
        kind: "account",
        secretHash: hash(person.token),
        expiresAt: new Date(Date.now() + 3600_000),
        presenceAt: new Date(),
      });
  }
  await db.insert(friendships).values([
    {
      requesterId: people[0]!.id,
      recipientId: people[1]!.id,
      status: "accepted",
    },
    {
      requesterId: people[0]!.id,
      recipientId: people[2]!.id,
      status: "pending",
    },
  ]);
  for (const [index, id] of roomIds.entries())
    await db
      .insert(rooms)
      .values({
        id,
        code: id.slice(0, 8).toUpperCase(),
        ownerUserId: people[1]!.id,
        name: "不可对外暴露的房间名",
        passwordHash: "private-room-secret",
        maxMembers: index ? 3 : 5,
      });
  await db.insert(members).values([
    {
      roomId: roomIds[0]!,
      userId: people[1]!.id,
      role: "owner",
      admittedUntil: admission(),
    },
    {
      roomId: roomIds[0]!,
      userId: people[2]!.id,
      role: "member",
      admittedUntil: admission(),
    },
    {
      roomId: roomIds[0]!,
      userId: people[3]!.id,
      role: "member",
      admittedUntil: null,
    },
  ]);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  const ids = people.map((person) => person.id);
  await db.delete(members).where(inArray(members.roomId, roomIds));
  await db.delete(rooms).where(inArray(rooms.id, roomIds));
  await db
    .delete(friendships)
    .where(
      or(
        inArray(friendships.requesterId, ids),
        inArray(friendships.recipientId, ids),
      ),
    );
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});

test("visible friends expose only human occupancy and the current room capacity", async () => {
  expect((await friend()).room).toEqual({ memberCount: 2, maxMembers: 5 });
  expect(
    (await friends()).find((item) => item.userId === people[2]!.id)!.room,
  ).toBeNull();
  await db
    .update(rooms)
    .set({ maxMembers: 8 })
    .where(eq(rooms.id, roomIds[0]!));
  expect((await friend()).room).toEqual({ memberCount: 2, maxMembers: 8 });
  await db
    .update(members)
    .set({ admittedUntil: null })
    .where(
      and(eq(members.roomId, roomIds[0]!), eq(members.userId, people[2]!.id)),
    );
  expect((await friend()).room).toEqual({ memberCount: 1, maxMembers: 8 });
});
test("invisible, offline and disabled peers do not reveal room activity", async () => {
  await db
    .update(users)
    .set({ presenceVisibility: "invisible" })
    .where(eq(users.id, people[1]!.id));
  expect(await friend()).toMatchObject({ online: false, room: null });
  await db
    .update(users)
    .set({ presenceVisibility: "online" })
    .where(eq(users.id, people[1]!.id));
  await db
    .update(credentials)
    .set({ presenceAt: new Date(Date.now() - 180_000) })
    .where(eq(credentials.userId, people[1]!.id));
  expect(await friend()).toMatchObject({ online: false, room: null });
  await db
    .update(credentials)
    .set({ presenceAt: new Date() })
    .where(eq(credentials.userId, people[1]!.id));
  await db
    .update(users)
    .set({ disabledAt: new Date() })
    .where(eq(users.id, people[1]!.id));
  expect(await friend()).toMatchObject({ online: false, room: null });
  await db
    .update(users)
    .set({ disabledAt: null })
    .where(eq(users.id, people[1]!.id));
});
test("the latest active admission wins and expired, left or closed memberships are ignored", async () => {
  await db
    .insert(members)
    .values({
      roomId: roomIds[1]!,
      userId: people[1]!.id,
      role: "owner",
      joinedAt: new Date(Date.now() + 1000),
      admittedUntil: admission(),
    });
  expect((await friend()).room).toEqual({ memberCount: 1, maxMembers: 3 });
  await db
    .update(rooms)
    .set({ status: "closed" })
    .where(eq(rooms.id, roomIds[1]!));
  expect((await friend()).room).toEqual({ memberCount: 1, maxMembers: 8 });
  await db
    .update(members)
    .set({ admittedUntil: new Date(Date.now() - 1) })
    .where(eq(members.userId, people[1]!.id));
  expect((await friend()).room).toBeNull();
  await db
    .update(members)
    .set({ admittedUntil: null })
    .where(eq(members.userId, people[1]!.id));
  expect((await friend()).room).toBeNull();
});
