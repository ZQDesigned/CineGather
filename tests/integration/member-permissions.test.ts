import { afterAll, beforeAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  credentials,
  rooms,
  auditLogs,
} from "@cinegather/database";
import { inArray } from "drizzle-orm";
import { media } from "../../apps/api/src/media";
let app: Awaited<ReturnType<typeof createApp>>, base: string;
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const people: { id: string; token: string }[] = [],
  createdRooms: string[] = [];
async function req(
  path: string,
  token: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function create(owner = people[0]!) {
  const r = await req("/rooms", owner.token, {
    name: "限制测试房",
    maxMembers: 5,
  });
  expect(r.status).toBe(201);
  createdRooms.push(r.body.id);
  return r.body.id as string;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  for (let i = 0; i < 3; i++) {
    const result = await req("/accounts/register", "", {
      username: `it_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      displayName: "成员限制测试",
      password: "Integration account 123!",
    });
    expect(result.status).toBe(201);
    people.push({ id: result.body.user.id, token: result.body.sessionToken });
  }
  await db
    .update(users)
    .set({ screenShareEnabled: true })
    .where(
      inArray(
        users.id,
        people.map((p) => p.id),
      ),
    );
});
afterAll(async () => {
  await app?.close();
  for (const id of createdRooms) await media.deleteRoom(id);
  const ids = people.map((p) => p.id);
  if (ids.length) {
    await db.delete(rooms).where(inArray(rooms.ownerUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(credentials).where(inArray(credentials.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await pool.end();
});
test("room restrictions revoke native sharing, forbid new leases and mic tokens, survive rejoin and never unmute on restore", async () => {
  const [a, b, c] = people as [
    (typeof people)[number],
    (typeof people)[number],
    (typeof people)[number],
  ];
  const roomId = await create();
  await req(`/rooms/${roomId}/join`, a.token, {});
  await req(`/rooms/${roomId}/join`, b.token, {});
  const participants = media.participants,
    share = media.setShare,
    permissions = media.setPermissions,
    send = media.client.sendData;
  const updates: unknown[][] = [];
  try {
    media.participants = async (id, ...args) =>
      id === roomId
        ? ([
            { identity: a.id },
            { identity: b.id, tracks: [] },
          ] as unknown as Awaited<ReturnType<typeof participants>>)
        : participants.call(media, id, ...args);
    media.setShare = async (id, user, allow) => {
      if (id !== roomId) await share.call(media, id, user, allow);
    };
    media.client.sendData = async () => {};
    media.setPermissions = async (...args) => {
      if (args[0] === roomId) updates.push(args);
      else await permissions.call(media, ...args);
    };
    const old = (await req(`/rooms/${roomId}/share-lease`, b.token, {})).body;
    expect(
      (
        await req(`/rooms/${roomId}/share-lease/native`, b.token, {
          leaseId: old.leaseId,
          revision: old.revision,
        })
      ).status,
    ).toBe(201);
    const url = `/rooms/${roomId}/members/${b.id}/permissions`;
    expect((await req(url, b.token, { microphoneAllowed: false })).status).toBe(
      403,
    );
    expect((await req(url, c.token, { microphoneAllowed: false })).status).toBe(
      403,
    );
    for (const invalid of [
      {},
      { microphoneAllowed: "false" },
      { sharingAllowed: false, muted: false },
    ])
      expect((await req(url, a.token, invalid)).status).toBe(400);
    const saved = await req(url, a.token, {
      microphoneAllowed: false,
      sharingAllowed: false,
    });
    expect(saved.status).toBe(201);
    expect(updates.at(-1)).toEqual([roomId, b.id, false, false]);
    expect(saved.body.memberPermissions).toContainEqual({
      userId: b.id,
      microphoneAllowed: false,
      sharingAllowed: false,
    });
    expect(await media.ingress.listIngress({ roomName: roomId })).toHaveLength(
      0,
    );
    for (const suffix of ["", "/renew", "/native"])
      expect(
        (
          await req(
            `/rooms/${roomId}/share-lease${suffix}`,
            b.token,
            suffix ? { leaseId: old.leaseId, revision: old.revision } : {},
          )
        ).body.code,
      ).toBe("ROOM_SHARE_FORBIDDEN");
    expect(
      (
        await req(`/rooms/${roomId}/members/${a.id}/permissions`, a.token, {
          sharingAllowed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          `/rooms/${roomId}/members/${b.id}`,
          a.token,
          { ban: false },
          "DELETE",
        )
      ).status,
    ).toBe(200);
    const rejoin = await req(`/rooms/${roomId}/join`, b.token, {});
    const claims = JSON.parse(
      Buffer.from(rejoin.body.token.split(".")[1], "base64url").toString(),
    );
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canPublishSources).not.toContain("microphone");
    const restored = await req(url, a.token, { microphoneAllowed: true });
    expect(restored.body.memberPermissions).toContainEqual({
      userId: b.id,
      microphoneAllowed: true,
      sharingAllowed: false,
    });
    const micJoin = await req(`/rooms/${roomId}/join`, b.token, {});
    expect(
      JSON.parse(
        Buffer.from(micJoin.body.token.split(".")[1], "base64url").toString(),
      ).video.canPublishSources,
    ).toEqual(["microphone"]);
    const otherRoom = await create(b);
    await req(`/rooms/${otherRoom}/join`, b.token, {});
    const unaffected = await req(`/rooms/${otherRoom}`, b.token);
    expect(unaffected.body.memberPermissions ?? []).toHaveLength(0);
    await req(url, a.token, { sharingAllowed: true });
    expect(
      (await req(`/rooms/${roomId}/share-lease`, b.token, {})).status,
    ).toBe(201);
  } finally {
    media.participants = participants;
    media.setShare = share;
    media.setPermissions = permissions;
    media.client.sendData = send;
  }
});

test("restrictions serialize with lease acquisition, reconciliation cannot restore banned sources, and promotion lifts the new owner's restriction", async () => {
  const a = people[0]!,
    b = people[1]!;
  const roomId = await create();
  await req(`/rooms/${roomId}/join`, a.token, {});
  await req(`/rooms/${roomId}/join`, b.token, {});
  const participants = media.participants,
    share = media.setShare,
    permissions = media.setPermissions,
    send = media.client.sendData;
  const applied: [string, string, boolean, boolean][] = [];
  try {
    media.participants = async (id, ...args) =>
      id === roomId
        ? ([
            {
              identity: a.id,
              tracks: [],
              permission: { canPublish: true, canPublishSources: [2] },
            },
            {
              identity: b.id,
              tracks: [],
              permission: { canPublish: true, canPublishSources: [2, 3, 4] },
            },
          ] as unknown as Awaited<ReturnType<typeof participants>>)
        : participants.call(media, id, ...args);
    media.setShare = async () => {};
    media.setPermissions = async (...args) => {
      applied.push(args);
    };
    media.client.sendData = async () => {};
    const url = `/rooms/${roomId}/members/${b.id}/permissions`;
    const [acquired, blocked] = await Promise.all([
      req(`/rooms/${roomId}/share-lease`, b.token, {}),
      req(url, a.token, { microphoneAllowed: false, sharingAllowed: false }),
    ]);
    expect([201, 403]).toContain(acquired.status);
    expect(blocked.status).toBe(201);
    expect(
      (await req(`/rooms/${roomId}/share-lease`, b.token, {})).body.code,
    ).toBe("ROOM_SHARE_FORBIDDEN");
    const { reconcileRoom } = await import("../../apps/api/src/rooms");
    await reconcileRoom(roomId);
    expect(applied.at(-1)).toEqual([roomId, b.id, false, false]);
    const transfer = await req(
      `/rooms/${roomId}/members/${b.id}/owner`,
      a.token,
      {},
    );
    expect(transfer.status).toBe(201);
    expect(transfer.body.memberPermissions ?? []).toHaveLength(0);
    expect(applied.at(-1)).toEqual([roomId, b.id, true, false]);
    expect(
      (await req(`/rooms/${roomId}/share-lease/preempt`, b.token, {})).status,
    ).toBe(201);
    expect((await req(url, a.token, { microphoneAllowed: true })).status).toBe(
      403,
    );
  } finally {
    media.participants = participants;
    media.setShare = share;
    media.setPermissions = permissions;
    media.client.sendData = send;
  }
});
