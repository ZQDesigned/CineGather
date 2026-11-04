import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/api/src/app";
import { readClientPolicy } from "../../apps/api/src/client-policy";
import { createDatabase, users, rooms, auditLogs } from "@cinegather/database";
import { inArray, eq } from "drizzle-orm";
import {
  currentFeatureProtocols,
  type FeaturePolicy,
} from "@cinegather/contracts";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const ids: string[] = [],
  roomIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, base: string, dir: string;
const old = { ...currentFeatureProtocols, "room.esports": [1] };
async function request(
  path: string,
  token?: string,
  body?: unknown,
  protocols = currentFeatureProtocols,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "X-CineGather-Platform": "win32",
      "X-CineGather-Version": "0.1.32",
      "X-CineGather-Features": "esports-v1,esports-v2",
      "X-CineGather-Protocols": JSON.stringify(protocols),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, status: response.status, body: await response.json() };
}
async function account() {
  const a = await request("/accounts/register", undefined, {
    username: "feature_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    password: "Feature compatibility test 123!",
    displayName: "功能兼容测试",
  });
  expect(a.status).toBe(201);
  ids.push(a.body.user.id);
  await db
    .update(users)
    .set({
      screenShareEnabled: true,
      esportsRoomsEnabled: true,
      highFrameRateEnabled: true,
      standardRoomMaxMembers: 25,
    })
    .where(eq(users.id, a.body.user.id));
  return a.body.sessionToken as string;
}
async function policy(value: FeaturePolicy) {
  await writeFile(join(dir, "feature-policy.json"), JSON.stringify(value));
  expect(
    await app
      .getHttpAdapter()
      .getInstance()
      .get("cinegather.featurePolicy")
      .refresh(),
  ).toBe(true);
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-feature-int-"));
  app = await createApp({
    clientPolicy: readClientPolicy({}),
    updateDirectory: dir,
  });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  const { media } = await import("../../apps/api/src/media");
  for (const id of roomIds) await media.deleteRoom(id);
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
test("a publish-only requirement preserves login, ordinary room voice admission, watching, cleanup and friends", async () => {
  const token = await account();
  await policy({
    format: 1,
    revision: 2,
    rules: [{ feature: "screen.publish", protocol: 2, reason: "共享需要更新" }],
  });
  const r = await request("/rooms", token, { name: "局部兼容", maxMembers: 5 });
  expect(r.status).toBe(201);
  roomIds.push(r.body.id);
  const id = r.body.id;
  expect((await request(`/rooms/${id}/join`, token, {})).status).toBe(201);
  expect(
    (await request(`/rooms/${id}/watch-admission`, token, {})).status,
  ).toBe(201);
  const denied = await request(`/rooms/${id}/share-lease`, token, {
    quality: "cinema",
  });
  expect(denied.status).toBe(426);
  expect(denied.body.compatibility.feature).toBe("screen.publish");
  expect(denied.response.headers.get("X-CineGather-Min-Version")).toBeNull();
  expect(denied.response.headers.get("X-CineGather-Update-Scope")).toBe(
    "feature",
  );
  expect((await request("/me", token)).status).toBe(200);
  expect((await request("/friends", token)).status).toBe(200);
  expect((await request(`/rooms/${id}`, token)).status).toBe(200);
  expect((await request(`/rooms/${id}/leave`, token, {})).status).toBe(201);
});
test("advanced room configuration rejects only old esports clients; optional requirements never become a global version floor", async () => {
  await policy({ format: 1, revision: 3, rules: [] });
  const owner = await account(),
    guest = await account();
  const made = await request("/rooms", owner, {
    name: "配置兼容赛事",
    mode: "esports",
    maxMembers: 20,
  });
  expect(made.status).toBe(201);
  const id = made.body.id;
  roomIds.push(id);
  expect((await request(`/rooms/${id}/join`, owner, {})).status).toBe(201);
  const configured = await request(
    `/rooms/${id}/esports/settings`,
    owner,
    {
      revision: 1,
      configuration: {
        groups: [
          { id: "a", name: "A 组", playerSeats: 5, coachSeats: 1 },
          { id: "b", name: "B 组", playerSeats: 5, coachSeats: 0 },
        ],
        tacticalPauseSeconds: 60,
      },
    },
    currentFeatureProtocols,
    "PATCH",
  );
  expect(configured.status).toBe(200);
  const denied = await request(`/rooms/${id}/join`, guest, {}, old);
  expect(denied.status).toBe(426);
  expect(denied.body.compatibility).toMatchObject({
    feature: "room.esports",
    protocol: 2,
  });
  expect((await request("/me", guest, undefined, old)).status).toBe(200);
  const ordinary = await request(
    "/rooms",
    guest,
    { name: "仍可使用普通房", maxMembers: 5 },
    old,
  );
  expect(ordinary.status).toBe(201);
  roomIds.push(ordinary.body.id);
  const global = await request("/client-policy");
  expect(
    Object.values(global.body.minimumVersions).every((v) => v === "0.0.0"),
  ).toBe(true);
  const feed = await request("/feature-policy");
  expect(feed.status).toBe(200);
  expect(feed.body.revision).toBe(3);
});
test("feature changes use a dedicated real-time event without advancing global policy", async () => {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(
      base + "/api/v1/client-events?platform=win32&arch=x64",
      { signal: abort.signal },
    );
    reader = response.body!.getReader();
    let text = "";
    const until = async (value: string) => {
      while (!text.includes(value)) {
        const next = await reader!.read();
        if (next.done) throw Error("closed");
        text += new TextDecoder().decode(next.value);
      }
    };
    await until("event: feature-policy");
    expect(text).toContain('"revision":3');
    await policy({
      format: 1,
      revision: 4,
      rules: [{ feature: "screen.watch", protocol: 2, reason: "观看需更新" }],
    });
    await until('"revision":4');
    expect(text.match(/event: policy\n/g)).toHaveLength(1);
    expect(text.match(/event: feature-policy\n/g)).toHaveLength(2);
  } finally {
    abort.abort();
    await reader?.cancel().catch(() => {});
  }
});
test("legacy mobile requests are refused locally without triggering their global426 updater", async () => {
  await policy({
    format: 1,
    revision: 5,
    rules: [
      { feature: "screen.publish", protocol: 2, reason: "仅共享功能需更新" },
    ],
  });
  const token = await account();
  const made = await request("/rooms", token, {
    name: "旧移动端兼容",
    maxMembers: 5,
  });
  expect(made.status).toBe(201);
  roomIds.push(made.body.id);
  await request(`/rooms/${made.body.id}/join`, token, {});
  const headers = {
    "content-type": "application/json",
    Authorization: "Bearer " + token,
    "X-CineGather-Platform": "android",
    "X-CineGather-Version": "0.2.0",
  };
  const blocked = await fetch(
    `${base}/api/v1/rooms/${made.body.id}/share-lease`,
    { method: "POST", headers, body: JSON.stringify({ quality: "cinema" }) },
  );
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).compatibility.feature).toBe("screen.publish");
  expect(blocked.headers.get("X-CineGather-Min-Version")).toBeNull();
  expect((await fetch(base + "/api/v1/me", { headers })).status).toBe(200);
  expect(
    (
      await fetch(`${base}/api/v1/rooms/${made.body.id}/leave`, {
        method: "POST",
        headers,
      })
    ).status,
  ).toBe(201);
});
