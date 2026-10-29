import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { config } from "../../apps/api/src/config";
import { hash } from "../../apps/api/src/context";
import {
  createDatabase,
  users,
  credentials,
  rooms,
  auditLogs,
  roomMemberPermissions,
} from "@cinegather/database";
import { inArray } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people = Array.from({ length: 7 }, (_, i) => ({
  id: randomUUID(),
  credential: randomUUID(),
  token: randomUUID(),
  platform: i === 6 ? "web" : "darwin",
}));
let app: Awaited<ReturnType<typeof createApp>>, base: string, roomId: string;
const initial = (config as typeof config & { karaokePreview?: boolean })
  .karaokePreview;
async function call(
  path: string,
  who = 0,
  data?: unknown,
  method = data ? "POST" : "GET",
) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + people[who]!.token,
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
const stage = (tail = "", who = 0, data?: unknown, method?: string) =>
  call(`/rooms/${roomId}/karaoke${tail}`, who, data, method);
beforeAll(async () => {
  for (const [i, p] of people.entries()) {
    await db.insert(users).values({
      id: p.id,
      username: "kara_" + p.id.replaceAll("-", "").slice(0, 20),
      displayName: "合唱测试" + i,
      passwordHash: "unused",
    });
    await db.insert(credentials).values({
      id: p.credential,
      userId: p.id,
      kind: "account",
      secretHash: hash(p.token),
      clientPlatform: p.platform,
      expiresAt: new Date(Date.now() + 3600000),
    });
  }
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  const result = await call("/rooms", 0, {
    name: "本地合唱验证",
    maxMembers: 10,
    access: "normal",
  });
  expect(result.status).toBe(201);
  roomId = result.body.id;
  for (let i = 0; i < people.length; i++)
    expect((await call(`/rooms/${roomId}/join`, i, {})).status).toBe(201);
});
afterAll(async () => {
  (config as typeof config & { karaokePreview?: boolean }).karaokePreview =
    initial;
  await app?.close();
  if (roomId) {
    const { media } = await import("../../apps/api/src/media");
    await media.deleteRoom(roomId);
    await db.delete(rooms).where(inArray(rooms.id, [roomId]));
  }
  const ids = people.map((p) => p.id);
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});
test("karaoke preview is opt-in, owner controlled and reserves at most four desktop singers", async () => {
  (config as typeof config & { karaokePreview?: boolean }).karaokePreview =
    false;
  expect((await stage()).status).toBe(404);
  (config as typeof config & { karaokePreview?: boolean }).karaokePreview =
    true;
  expect((await stage("", 1, { enabled: true })).status).toBe(403);
  expect((await stage("", 0, { enabled: true })).status).toBe(201);
  expect((await stage("/singers", 6, {})).status).toBe(403);
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map((i) => stage("/singers", i, {})),
  );
  expect(results.filter((r) => r.status === 201)).toHaveLength(4);
  expect(results.filter((r) => r.status === 409)).toHaveLength(1);
  const state = await stage();
  expect(state.body.enabled).toBe(true);
  expect(state.body.singers).toHaveLength(4);
  for (const p of people)
    expect(JSON.stringify(state.body)).not.toContain(p.credential);
  const singer = people.findIndex((p) => state.body.singers.includes(p.id));
  expect((await stage("/singers", singer, {})).status).toBe(201);
  const web = await call(`/rooms/${roomId}/join`, 6, {});
  const grant = JSON.parse(
    Buffer.from(web.body.token.split(".")[1], "base64url").toString(),
  ).video;
  expect(grant.canPublish).toBe(false);
  expect(
    (await stage(`/singers/${people[singer]!.id}`, 5, undefined, "DELETE"))
      .status,
  ).toBe(403);
  expect(
    (await stage(`/singers/${people[singer]!.id}`, 0, undefined, "DELETE"))
      .status,
  ).toBe(200);
  expect((await stage()).body.singers).toHaveLength(3);
  expect((await stage("/singers", 5, {})).status).toBe(201);
  expect((await call(`/rooms/${roomId}/leave`, 5, {})).status).toBe(201);
  expect((await stage()).body.singers).not.toContain(people[5]!.id);
  expect((await stage("", 0, { enabled: false })).status).toBe(201);
  expect((await stage()).body.singers).toEqual([]);
  expect((await stage("/singers", 1, {})).status).toBe(409);
});

test("moderation, device revocation and leaving release seats without restoring microphone rights", async () => {
  expect((await stage("", 0, { enabled: true })).status).toBe(201);
  expect((await stage("/singers", 1, {})).status).toBe(201);
  await db.insert(roomMemberPermissions).values({
    roomId,
    userId: people[1]!.id,
    microphoneAllowed: false,
    sharingAllowed: true,
  });
  expect((await stage()).body.singers).not.toContain(people[1]!.id);
  expect((await stage("/singers", 1, {})).status).toBe(403);
  expect((await stage("/singers", 2, {})).status).toBe(201);
  await db
    .update(credentials)
    .set({ revokedAt: new Date() })
    .where(inArray(credentials.id, [people[2]!.credential]));
  expect((await stage()).body.singers).not.toContain(people[2]!.id);
  expect((await stage("/singers", 3, {})).status).toBe(201);
  expect(
    (
      await call(
        `/rooms/${roomId}/members/${people[3]!.id}`,
        0,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect((await stage()).body.singers).not.toContain(people[3]!.id);
  expect((await stage("", 0, { enabled: false })).status).toBe(201);
  const denied = await call(`/rooms/${roomId}/join`, 1, {});
  expect(
    JSON.parse(
      Buffer.from(denied.body.token.split(".")[1], "base64url").toString(),
    ).video.canPublish,
  ).toBe(false);
});

test("explicit room departure never silently restores a singing seat on re-entry", async () => {
  expect((await stage("", 0, { enabled: true })).status).toBe(201);
  expect((await stage("/singers", 4, {})).status).toBe(201);
  expect((await call(`/rooms/${roomId}/leave`, 4, {})).status).toBe(201);
  expect((await call(`/rooms/${roomId}/join`, 4, {})).status).toBe(201);
  expect((await stage()).body.singers).not.toContain(people[4]!.id);
  expect((await stage("/singers", 4, {})).status).toBe(201);
  await stage("", 0, { enabled: false });
});
