import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/api/src/app";
import { readClientPolicy } from "../../apps/api/src/modules/updates/client-policy";
import { publishBundle } from "@cinegather/update-core";
import { createDatabase, users, rooms, auditLogs } from "@cinegather/database";
import { inArray } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>, base: string, dir: string;
const ids: string[] = [],
  roomIds: string[] = [];
const keys = generateKeyPairSync("ed25519"),
  publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  privateKey = keys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
const identity = {
  platform: "win32" as const,
  arch: "x64" as const,
  runtime: "8".repeat(64),
};
async function request(
  path: string,
  token?: string,
  body?: unknown,
  revision = 0,
) {
  const response = await fetch(base + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CineGather-Platform": "win32",
      "X-CineGather-Version": "0.1.42",
      "X-CineGather-Runtime": identity.runtime,
      "X-CineGather-Arch": "x64",
      "X-CineGather-Revision": String(revision),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    status: response.status,
    body: response.status === 204 ? undefined : await response.json(),
  };
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-hot-api-"));
  await mkdir(join(dir, "input"));
  await writeFile(join(dir, "input/index.html"), "test");
  app = await createApp({
    updateDirectory: dir,
    desktopUpdateKey: publicKey,
    clientPolicy: readClientPolicy({}),
  });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  const { media } = await import("../../apps/api/src/modules/media/media");
  for (const id of roomIds) await media.deleteRoom(id);
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
test("signed HTTP distribution and actual auth guard preserve an admitted room but block new old-UI sessions", async () => {
  const a = await request("/accounts/register", undefined, {
    username: "hot_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    password: "Hot update test 123!",
    displayName: "界面更新测试",
  });
  expect(a.status).toBe(201);
  ids.push(a.body.user.id);
  const token = a.body.sessionToken;
  const room = await request("/rooms", token, {
    name: "热更新兼容测试",
    maxMembers: 5,
  });
  expect(room.status).toBe(201);
  roomIds.push(room.body.id);
  expect((await request(`/rooms/${room.body.id}/join`, token, {})).status).toBe(
    201,
  );
  const published = await publishBundle({
    input: join(dir, "input"),
    output: join(dir, "desktop-ui"),
    identity,
    privateKey,
    revision: 1,
    sequence: 1,
    minimumRevision: 1,
    featureMinimums: {},
    notes: "",
  });
  const policy = await request(
    `/desktop-updates/policy?platform=win32&arch=x64&runtime=${identity.runtime}`,
  );
  expect(policy.status).toBe(200);
  expect(policy.body.signature).toBeTruthy();
  const manifest = await fetch(
    base + `/api/v1/desktop-updates/manifests/${published.bundleId}.json`,
  );
  expect(manifest.status).toBe(200);
  expect(manifest.headers.get("cache-control")).toContain("immutable");
  const asset = await fetch(
    base +
      `/api/v1/desktop-updates/assets/${published.manifest.files[0]!.compressedSha256}.gz`,
  );
  expect(asset.status).toBe(200);
  expect(asset.headers.get("content-encoding")).toBeNull();
  expect((await request(`/rooms/${room.body.id}/join`, token, {})).status).toBe(
    201,
  );
  expect((await request(`/rooms/${room.body.id}`, token)).status).toBe(200);
  expect(
    (await request("/rooms", token, { name: "禁止新业务", maxMembers: 5 }))
      .status,
  ).toBe(426);
  expect(
    (await request(`/rooms/${room.body.id}/leave`, token, {})).status,
  ).toBe(201);
  const fresh = await request(
    "/rooms",
    token,
    { name: "新版可用", maxMembers: 5 },
    1,
  );
  expect(fresh.status).toBe(201);
  roomIds.push(fresh.body.id);
});
