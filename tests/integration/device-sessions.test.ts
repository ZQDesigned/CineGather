import { beforeAll, afterAll, test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  credentials,
  rooms,
  auditLogs,
  leases,
  shareRequests,
  roomSessions,
  nativePublications,
} from "@cinegather/database";
import { eq, inArray, and } from "drizzle-orm";
import { media } from "../../apps/api/src/media";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof createApp>>, base: string;
const ids: string[] = [],
  roomIds: string[] = [];
const password = "Device sessions test 123!";
async function req(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  platform = "web",
) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "X-CineGather-Platform": platform,
      "X-CineGather-Version": "0.1.18",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function account() {
  const r = await req("/accounts/register", undefined, {
    username: "devices_" + crypto.randomUUID().replaceAll("-", "").slice(0, 18),
    displayName: "设备管理测试",
    password,
  });
  expect(r.status).toBe(201);
  ids.push(r.body.user.id);
  return r.body;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  for (const id of roomIds) await media.deleteRoom(id);
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
});
test("device sessions list only own safe metadata and revoke a selected session without logging out the caller", async () => {
  const a = await account(),
    b = await account();
  const second = await req(
    "/accounts/login",
    undefined,
    { username: a.user.username, password },
    "POST",
    "win32",
  );
  expect(second.status).toBe(201);
  const list = await req("/accounts/sessions", a.sessionToken);
  expect(list.status).toBe(200);
  expect(list.body.items).toHaveLength(2);
  const current = list.body.items.find((s: { current: boolean }) => s.current),
    other = list.body.items.find((s: { current: boolean }) => !s.current);
  expect(current).toBeDefined();
  expect(other.deviceName).toBe("Windows 客户端");
  expect(JSON.stringify(list.body)).not.toContain("secretHash");
  expect(JSON.stringify(list.body)).not.toContain(a.sessionToken);
  expect(JSON.stringify(list.body)).not.toContain(second.body.sessionToken);
  expect(
    (
      await req(
        "/accounts/sessions/" + current.id,
        b.sessionToken,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await req(
        "/accounts/sessions/" + other.id,
        a.sessionToken,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect((await req("/me", second.body.sessionToken)).status).toBe(401);
  expect((await req("/me", a.sessionToken)).status).toBe(200);
  expect(
    (await req("/accounts/sessions", a.sessionToken)).body.items,
  ).toHaveLength(1);
});
test("exit other devices preserves the authenticated session and does not cross account boundaries", async () => {
  const a = await account(),
    b = await account();
  const second = await req("/accounts/login", undefined, {
    username: a.user.username,
    password,
  });
  expect(
    (await req("/accounts/sessions", a.sessionToken, undefined, "DELETE"))
      .status,
  ).toBe(200);
  expect((await req("/me", a.sessionToken)).status).toBe(200);
  expect((await req("/me", second.body.sessionToken)).status).toBe(401);
  expect((await req("/me", b.sessionToken)).status).toBe(200);
});
test("revoking one device removes its exact media peer and keeps the other device connection", async () => {
  const a = await account();
  const second = (
    await req("/accounts/login", undefined, {
      username: a.user.username,
      password,
    })
  ).body;
  const created = await req("/rooms", a.sessionToken, {
    name: "会话隔离测试",
    maxMembers: 5,
  });
  expect(created.status).toBe(201);
  const roomId = created.body.id;
  roomIds.push(roomId);
  const one = await req(`/rooms/${roomId}/join`, a.sessionToken, {}),
    two = await req(`/rooms/${roomId}/join`, second.sessionToken, {});
  expect(one.status).toBe(201);
  expect(two.status).toBe(201);
  const sub = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString())
      .sub as string;
  const firstIdentity = sub(one.body.token),
    secondIdentity = sub(two.body.token);
  expect(firstIdentity).not.toBe(secondIdentity);
  expect(firstIdentity).toStartWith("cinegather/member/v1/" + a.user.id + "/");
  const list = (await req("/accounts/sessions", a.sessionToken)).body.items;
  const firstId = list.find((s: { current: boolean }) => s.current).id;
  expect(firstIdentity).toEndWith("/" + firstId);
  const otherId = list.find((s: { current: boolean }) => !s.current).id;
  await db
    .update(roomSessions)
    .set({ admittedUntil: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(roomSessions.roomId, roomId),
        eq(roomSessions.credentialId, otherId),
      ),
    );
  const originalList = media.client.listParticipants.bind(media.client),
    originalRemove = media.client.removeParticipant.bind(media.client),
    originalChange = media.client.updateParticipant.bind(media.client);
  let peers = [firstIdentity, secondIdentity];
  const removed: string[] = [];
  let rejectRemoval = true;
  media.client.listParticipants = async (id) =>
    id === roomId
      ? (peers.map((identity) => ({
          identity,
          name: "设备",
          tracks: [],
        })) as unknown as Awaited<ReturnType<typeof originalList>>)
      : originalList(id);
  media.client.updateParticipant = async (id, identity, options) => {
    if (id !== roomId)
      return typeof options === "object"
        ? originalChange(id, identity, options)
        : originalChange(id, identity, options);
    return { identity, tracks: [] } as unknown as Awaited<
      ReturnType<typeof originalChange>
    >;
  };
  media.client.removeParticipant = async (id, identity, options) => {
    if (id !== roomId) return originalRemove(id, identity, options);
    if (identity === firstIdentity && rejectRemoval) {
      rejectRemoval = false;
      throw new Error("temporary media outage");
    }
    removed.push(identity);
    peers = peers.filter((p) => p !== identity);
  };
  const leaseId = crypto.randomUUID();
  const publication = await media.createNative(
    roomId,
    { id: a.user.id, displayName: "设备隔离测试" },
    leaseId,
  );
  await db
    .update(leases)
    .set({
      holderUserId: a.user.id,
      credentialId: otherId,
      leaseId,
      revision: 1,
      expiresAt: new Date(Date.now() + 30_000),
    })
    .where(eq(leases.roomId, roomId));
  await db.insert(nativePublications).values({
    roomId,
    holderUserId: a.user.id,
    credentialId: otherId,
    leaseId,
    revision: 1,
    identity: publication.participantIdentity,
    ingressId: publication.ingressId,
  });
  try {
    expect(
      (
        await req(
          "/accounts/sessions",
          second.sessionToken,
          undefined,
          "DELETE",
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await req(
          "/accounts/sessions",
          second.sessionToken,
          undefined,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(removed).toEqual([firstIdentity]);
    expect(peers).toEqual([secondIdentity]);
    expect((await req("/me", second.sessionToken)).status).toBe(200);
    expect((await req(`/rooms/${roomId}`, second.sessionToken)).status).toBe(
      200,
    );
    expect((await req("/me", a.sessionToken)).body.code).toBe(
      "SESSION_REVOKED",
    );
    expect(
      (await media.ingress.listIngress({ roomName: roomId })).map(
        (p) => p.ingressId,
      ),
    ).toContain(publication.ingressId);
    expect(
      (await db.select().from(leases).where(eq(leases.roomId, roomId)))[0]!
        .credentialId,
    ).toBe(otherId);
    expect(
      (await req("/session", second.sessionToken, undefined, "DELETE")).status,
    ).toBe(200);
    expect(await media.ingress.listIngress({ roomName: roomId })).toHaveLength(
      0,
    );
  } finally {
    media.client.listParticipants = originalList;
    media.client.removeParticipant = originalRemove;
    media.client.updateParticipant = originalChange;
    await media.deleteNative(
      roomId,
      publication.participantIdentity,
      publication.ingressId,
    );
  }
});

test("handoff only transfers after the approved device confirms, with stale and foreign requests rejected", async () => {
  const a = await account(),
    b = await account(),
    c = await account();
  await db
    .update(users)
    .set({ screenShareEnabled: true })
    .where(inArray(users.id, [a.user.id, b.user.id, c.user.id]));
  const created = await req("/rooms", a.sessionToken, {
    name: "接棒测试",
    maxMembers: 5,
  });
  const roomId = created.body.id;
  roomIds.push(roomId);
  const identities: string[] = [];
  for (const account of [a, b, c]) {
    const joined = await req(`/rooms/${roomId}/join`, account.sessionToken, {});
    expect(joined.status).toBe(201);
    identities.push(
      JSON.parse(
        Buffer.from(joined.body.token.split(".")[1]!, "base64url").toString(),
      ).sub,
    );
  }
  const list = media.client.listParticipants.bind(media.client),
    get = media.client.getParticipant.bind(media.client),
    change = media.client.updateParticipant.bind(media.client),
    send = media.client.sendData.bind(media.client);
  const fake = (identity: string) =>
    ({
      identity,
      name: "接棒",
      tracks: [],
      permission: { canPublish: true, canPublishSources: [2] },
    }) as unknown as Awaited<ReturnType<typeof get>>;
  const changes: { identity: string; sharing: boolean }[] = [];
  media.client.listParticipants = async (id) =>
    id === roomId ? identities.map(fake) : list(id);
  media.client.getParticipant = async (id, identity) =>
    id === roomId ? fake(identity) : get(id, identity);
  media.client.updateParticipant = async (id, identity, options) => {
    if (id !== roomId)
      return typeof options === "object"
        ? change(id, identity, options)
        : change(id, identity, options);
    changes.push({
      identity,
      sharing: Boolean(
        typeof options === "object" &&
          options.permission?.canPublishSources?.includes(3),
      ),
    });
    return fake(identity);
  };
  media.client.sendData = async (id, ..._args) => {
    if (id !== roomId) throw new Error("unexpected room");
  };
  try {
    const initial = await req(
      `/rooms/${roomId}/share-lease`,
      a.sessionToken,
      {},
    );
    expect(initial.status).toBe(201);
    const count = changes.length;
    expect(
      (await req(`/rooms/${roomId}/share-requests`, b.sessionToken, {})).status,
    ).toBe(201);
    const queue = (await req(`/rooms/${roomId}/share-requests`, a.sessionToken))
      .body.items;
    expect(queue).toHaveLength(1);
    const requestId = queue[0].id;
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${requestId}/acquire`,
          b.sessionToken,
          {},
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${requestId}/approve`,
          c.sessionToken,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${requestId}/approve`,
          a.sessionToken,
          {},
        )
      ).status,
    ).toBe(201);
    expect(changes).toHaveLength(count);
    expect(
      (await db.select().from(leases).where(eq(leases.roomId, roomId)))[0]!
        .holderUserId,
    ).toBe(a.user.id);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${requestId}/acquire`,
          c.sessionToken,
          {},
        )
      ).status,
    ).toBe(409);
    const accepted = await req(
      `/rooms/${roomId}/share-requests/${requestId}/acquire`,
      b.sessionToken,
      {},
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.holderUserId).toBe(b.user.id);
    expect(accepted.body.revision).toBe(initial.body.revision + 1);
    expect(changes.at(-1)).toEqual({ identity: identities[1]!, sharing: true });
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${requestId}/acquire`,
          b.sessionToken,
          {},
        )
      ).status,
    ).toBe(409);
    expect(
      (await req(`/rooms/${roomId}/share-requests`, a.sessionToken)).body.items,
    ).toHaveLength(0);
    const extra = (
      await req("/accounts/login", undefined, {
        username: b.user.username,
        password,
      })
    ).body;
    const extraJoin = await req(
      `/rooms/${roomId}/join`,
      extra.sessionToken,
      {},
    );
    const extraIdentity = JSON.parse(
      Buffer.from(extraJoin.body.token.split(".")[1]!, "base64url").toString(),
    ).sub;
    identities.push(extraIdentity);
    const beforePolicy = changes.length;
    expect(
      (
        await req(
          `/rooms/${roomId}/members/${b.user.id}/permissions`,
          a.sessionToken,
          { microphoneAllowed: false },
        )
      ).status,
    ).toBe(201);
    expect(changes.slice(beforePolicy)).toEqual([
      { identity: identities[1]!, sharing: true },
      { identity: extraIdentity, sharing: false },
    ]);
    // Permission changes are rechecked at consumption, not just at approval.
    await req(`/rooms/${roomId}/share-requests`, c.sessionToken, {});
    const next = (await req(`/rooms/${roomId}/share-requests`, b.sessionToken))
      .body.items[0];
    await req(
      `/rooms/${roomId}/share-requests/${next.id}/approve`,
      b.sessionToken,
      {},
    );
    await db
      .update(users)
      .set({ screenShareEnabled: false })
      .where(eq(users.id, c.user.id));
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${next.id}/acquire`,
          c.sessionToken,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (await db.select().from(leases).where(eq(leases.roomId, roomId)))[0]!
        .holderUserId,
    ).toBe(b.user.id);
    await db
      .update(users)
      .set({ screenShareEnabled: true })
      .where(eq(users.id, c.user.id));
    await db
      .update(shareRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        and(
          eq(shareRequests.roomId, roomId),
          eq(shareRequests.userId, c.user.id),
        ),
      );
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${next.id}/acquire`,
          c.sessionToken,
          {},
        )
      ).status,
    ).toBe(409);
    expect(
      (await req(`/rooms/${roomId}/share-requests`, c.sessionToken, {})).status,
    ).toBe(201);
    expect(
      (await req(`/rooms/${roomId}/share-requests`, a.sessionToken, {})).status,
    ).toBe(201);
    const ordered = (
      await req(`/rooms/${roomId}/share-requests`, b.sessionToken)
    ).body.items;
    expect(ordered.map((r: { userId: string }) => r.userId)).toEqual([
      c.user.id,
      a.user.id,
    ]);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${ordered[1].id}/approve`,
          b.sessionToken,
          {},
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests`,
          c.sessionToken,
          undefined,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${ordered[1].id}/approve`,
          b.sessionToken,
          {},
        )
      ).status,
    ).toBe(201);
    expect(
      (await req(`/rooms/${roomId}/share-lease/preempt`, a.sessionToken, {}))
        .status,
    ).toBe(201);
    expect(
      (
        await req(
          `/rooms/${roomId}/share-requests/${ordered[1].id}/acquire`,
          a.sessionToken,
          {},
        )
      ).status,
    ).toBe(409);
  } finally {
    media.client.listParticipants = list;
    media.client.getParticipant = get;
    media.client.updateParticipant = change;
    media.client.sendData = send;
  }
});
