import { config } from "../../apps/api/src/config";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  rooms,
  members,
  credentials,
  auditLogs,
  userRoles,
  adminRoles,
  idempotency,
  invites,
  esportsSeats,
} from "@cinegather/database";
import { and, eq, inArray } from "drizzle-orm";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
if (
  !new URL(process.env.DATABASE_URL!).pathname.includes("esports") &&
  !process.env.CI
)
  throw Error("Run esports integration against its isolated database");
let app: Awaited<ReturnType<typeof createApp>>, origin: string;
let gateway: ReturnType<
  typeof import("../../apps/api/src/esports-dev-gateway").startEsportsDevGateway
>;
const created: string[] = [];
const createdRoles: string[] = [];
async function req(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  features = "esports-v1",
  platform = "web",
) {
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CineGather-Platform": platform,
      "X-CineGather-Features": features,
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function account(platform = "web") {
  const r = await req(
    "/accounts/register",
    undefined,
    {
      username:
        "esports_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      displayName: "赛事测试",
      password: "Esports isolation test 123!",
    },
    "POST",
    "esports-v1",
    platform,
  );
  expect(r.status).toBe(201);
  created.push(r.body.user.id);
  return { id: r.body.user.id as string, token: r.body.sessionToken as string };
}
beforeAll(async () => {
  config.esportsGatewayUrl ??= "ws://127.0.0.1:17882";
  config.esportsAdmissionSecret ??= "fixture".repeat(12);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
  const { startEsportsDevGateway } = await import(
    "../../apps/api/src/esports-dev-gateway"
  );
  gateway = startEsportsDevGateway({
    port: 17882,
    apiUrl: origin,
    upstreamUrl: config.livekitInternalUrl,
    secret: process.env.ESPORTS_ADMISSION_SECRET!,
  });
});
afterAll(async () => {
  gateway?.stop(true);
  await app?.close();
  const { media } = await import("../../apps/api/src/media");
  const matches = created.length
    ? await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(inArray(rooms.ownerUserId, created))
    : [];
  const { closeEsports } = await import("../../apps/api/src/esports");
  for (const room of matches) {
    await db.transaction((tx) => closeEsports(tx, room.id));
    for (const child of await media.client.listRooms())
      if (child.name.startsWith(`cg-esports/${room.id}/`))
        await media.deleteRoom(child.name);
    await media.deleteRoom(room.id);
  }
  if (created.length)
    await db.transaction(async (tx) => {
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, created));
      await tx.delete(members).where(inArray(members.userId, created));
      await tx.delete(auditLogs).where(inArray(auditLogs.actorId, created));
      await tx.delete(userRoles).where(inArray(userRoles.userId, created));
      if (createdRoles.length)
        await tx.delete(adminRoles).where(inArray(adminRoles.id, createdRoles));
      await tx.delete(idempotency).where(inArray(idempotency.userId, created));
      await tx.delete(credentials).where(inArray(credentials.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  await pool.end();
});

test("only an explicitly authorized account creates esports rooms; superadmin grants are audited", async () => {
  const root = await account(),
    host = await account();
  expect(
    (await req("/rooms", host.token, { name: "训练赛", mode: "esports" }))
      .status,
  ).toBe(403);
  expect(
    (
      await req(`/admin/users/${host.id}/esports`, host.token, {
        enabled: true,
        reason: "cannot grant self",
      })
    ).status,
  ).toBe(403);
  await db
    .update(users)
    .set({ isSuperAdmin: true })
    .where(eq(users.id, root.id));
  expect(
    (
      await req(`/admin/users/${host.id}/esports`, root.token, {
        enabled: true,
        reason: "test authorization",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", host.token)).body.esportsRoomsEnabled).toBe(true);
  const match = await req("/rooms", host.token, {
    name: "训练赛",
    mode: "esports",
  });
  expect(match.status).toBe(201);
  expect(match.body).toMatchObject({ mode: "esports", maxMembers: 20 });
  expect(
    (await req("/rooms", host.token, { name: "普通房", maxMembers: 11 }))
      .status,
  ).toBe(403);
  expect(
    (
      await req(`/admin/users/${host.id}/esports`, root.token, {
        enabled: false,
        reason: "end test authorization",
      })
    ).status,
  ).toBe(201);
  expect(
    (await req("/rooms", host.token, { name: "another", mode: "esports" }))
      .status,
  ).toBe(403);
  const events = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, host.id));
  expect(
    events.filter((e) => e.action === "admin.esports_capability_updated"),
  ).toHaveLength(2);
});

test("storage rejects invalid seat/team pairs and unbound targeted invitations", async () => {
  const owner = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const r = await req("/rooms", owner.token, {
    name: "constraint test",
    mode: "esports",
  });
  expect(r.status).toBe(201);
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, owner.id));
  await expect(
    db
      .insert(esportsSeats)
      .values({
        roomId: r.body.id,
        userId: owner.id,
        credentialId: credential!.id,
        kind: "player",
        team: null,
      })
      .execute(),
  ).rejects.toThrow();
  const base = {
    id: crypto.randomUUID(),
    roomId: r.body.id,
    createdBy: owner.id,
    tokenHash: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60000),
    maxUses: 1,
  };
  await expect(
    db
      .insert(invites)
      .values({
        ...base,
        esportsSeat: null,
        esportsTeam: "a",
        recipientId: owner.id,
      })
      .execute(),
  ).rejects.toThrow();
  await expect(
    db
      .insert(invites)
      .values({
        ...base,
        id: crypto.randomUUID(),
        esportsSeat: "player",
        esportsTeam: "a",
      })
      .execute(),
  ).rejects.toThrow();
});

test("ordinary administrators require the dedicated esports management permission", async () => {
  const actor = await account(),
    target = await account(),
    role = crypto.randomUUID();
  createdRoles.push(role);
  await db.insert(adminRoles).values({
    id: role,
    name: "esports test " + role,
    permissions: ["users.read", "users.manage"],
  });
  await db.insert(userRoles).values({ userId: actor.id, roleId: role });
  expect(
    (
      await req(`/admin/users/${target.id}/esports`, actor.token, {
        enabled: true,
        reason: "not enough permission",
      })
    ).status,
  ).toBe(403);
  await db
    .update(adminRoles)
    .set({ permissions: ["users.read", "users.esports"] })
    .where(eq(adminRoles.id, role));
  expect(
    (
      await req(`/admin/users/${target.id}/esports`, actor.token, {
        enabled: true,
        reason: "scoped permission",
      })
    ).status,
  ).toBe(201);
  expect((await req("/me", target.token)).body.esportsRoomsEnabled).toBe(true);
});

test("esports joins are control-only, seat-scoped connections reject stale and cross-team grants", async () => {
  const host = await account(),
    viewer = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, host.id));
  const room = (
    await req("/rooms", host.token, { name: "隔离验证", mode: "esports" })
  ).body;
  const joined = await req(`/rooms/${room.id}/join`, host.token, {});
  expect(joined.status).toBe(201);
  const grant = JSON.parse(
    Buffer.from(joined.body.token.split(".")[1], "base64url").toString(),
  );
  expect(grant.video).toMatchObject({ canPublish: false, canSubscribe: false });
  const snapshot = await req(`/rooms/${room.id}/esports`, host.token);
  expect(snapshot.status).toBe(200);
  expect(snapshot.body.self.seat).toEqual({ kind: "audience" });
  const assigned = await req(
    `/rooms/${room.id}/esports/members/${host.id}/seat`,
    host.token,
    { kind: "player", team: "a" },
  );
  expect(assigned.status).toBe(201);
  const current = (await req(`/rooms/${room.id}/esports`, host.token)).body;
  const connection = (channel: unknown, seatRevision = current.self.revision) =>
    req(`/rooms/${room.id}/esports/connection`, host.token, {
      channel,
      seatRevision,
    });
  expect((await connection({ kind: "team", team: "b" })).status).toBe(403);
  expect((await connection({ kind: "team", team: "a" }, 1)).status).toBe(409);
  const voice = await connection({ kind: "team", team: "a" });
  expect(voice.status).toBe(201);
  expect(
    (
      await req(`/rooms/${room.id}/esports/share-lease`, host.token, {
        quality: "game",
      })
    ).status,
  ).toBe(403);
  await db
    .update(users)
    .set({ highFrameRateEnabled: true })
    .where(eq(users.id, host.id));
  const game = await req(`/rooms/${room.id}/esports/share-lease`, host.token, {
    quality: "game",
  });
  expect(game.status).toBe(201);
  await db
    .update(users)
    .set({ highFrameRateEnabled: false })
    .where(eq(users.id, host.id));
  const gameRef = { leaseId: game.body.leaseId, revision: game.body.revision };
  expect(
    (
      await req(
        `/rooms/${room.id}/esports/share-lease/renew`,
        host.token,
        gameRef,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await req(`/rooms/${room.id}/esports/share-lease/native`, host.token, {
        ...gameRef,
        quality: "game",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await req(
        `/rooms/${room.id}/esports/share-lease`,
        host.token,
        gameRef,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(
    (await req(`/rooms/${room.id}/esports/share-lease`, host.token, {})).status,
  ).toBe(201);
  expect((await req(`/rooms/${room.id}/messages`, host.token)).status).toBe(
    403,
  );
  expect(
    (await req(`/rooms/${room.id}/share-lease`, host.token, {})).status,
  ).toBe(403);
  expect((await req(`/rooms/${room.id}/join`, viewer.token, {})).status).toBe(
    201,
  );
  const audience = (await req(`/rooms/${room.id}/esports`, viewer.token)).body;
  expect(audience.self.seat).toEqual({ kind: "audience" });
  expect(
    (await req(`/rooms/${room.id}/esports/share-lease`, viewer.token, {}))
      .status,
  ).toBe(403);
});

test("signed media admission rejects cross-seat and expired watch tokens; commit promotes only the warmed stream", async () => {
  const host = await account(),
    viewer = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, host.id));
  const room = (
    await req("/rooms", host.token, { name: "令牌与预热", mode: "esports" })
  ).body;
  await req(`/rooms/${room.id}/join`, host.token, {});
  await req(`/rooms/${room.id}/esports/members/${host.id}/seat`, host.token, {
    kind: "player",
    team: "b",
  });
  const lease = (
    await req(`/rooms/${room.id}/esports/share-lease`, host.token, {})
  ).body;
  await req(`/rooms/${room.id}/join`, viewer.token, {});
  const initial = (await req(`/rooms/${room.id}/esports`, viewer.token)).body;
  const conn = (id: string, rev?: number) =>
    req(`/rooms/${room.id}/esports/connection`, viewer.token, {
      channel: { kind: "video", publicationId: id },
      seatRevision: initial.self.revision,
      ...(rev === undefined ? {} : { watchRevision: rev }),
    });
  expect((await conn(lease.publicationId)).status).toBe(403);
  const warm = (
    await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
      action: "select",
      publicationId: lease.publicationId,
      revision: 0,
    })
  ).body;
  expect(warm.watch).toMatchObject({
    current: null,
    warming: lease.publicationId,
    monitorTeam: null,
  });
  expect(
    warm.publications.find((p: { id: string }) => p.id === lease.publicationId)
      ?.status,
  ).toBe("starting");
  const video = await conn(lease.publicationId, warm.watch.revision);
  expect(video.status).toBe(201);
  const { admitMediaToken } = await import(
    "../../apps/api/src/esports-admission"
  );
  await expect(admitMediaToken(video.body.token)).resolves.toBeUndefined();
  const committed = await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
    action: "commit",
    publicationId: lease.publicationId,
    revision: warm.watch.revision,
  });
  expect(committed.status).toBe(201);
  expect(committed.body.watch).toMatchObject({
    current: lease.publicationId,
    warming: null,
    monitorTeam: "b",
  });
  await expect(admitMediaToken(video.body.token)).resolves.toBeUndefined();
  const monitor = await req(
    `/rooms/${room.id}/esports/connection`,
    viewer.token,
    {
      channel: { kind: "team", team: "b" },
      seatRevision: initial.self.revision,
    },
  );
  expect(monitor.status).toBe(201);
  const claims = JSON.parse(
    Buffer.from(monitor.body.token.split(".")[1], "base64url").toString(),
  );
  expect(claims.video).toMatchObject({
    canPublish: false,
    canSubscribe: true,
    canPublishSources: [],
  });
  await expect(admitMediaToken(monitor.body.token)).resolves.toBeUndefined();
  expect(
    (
      await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
        action: "stop",
        revision: committed.body.watch.revision,
      })
    ).status,
  ).toBe(201);
  await expect(admitMediaToken(video.body.token)).rejects.toThrow();
  await expect(admitMediaToken(monitor.body.token)).rejects.toThrow();
  const next = (
    await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
      action: "select",
      publicationId: lease.publicationId,
      revision: committed.body.watch.revision + 1,
    })
  ).body;
  expect(next.watch.warming).toBe(lease.publicationId);
  await expect(admitMediaToken(video.body.token)).rejects.toThrow();
  const ownResponse = await req(
    `/rooms/${room.id}/esports/connection`,
    host.token,
    { channel: { kind: "team", team: "b" }, seatRevision: 2 },
  );
  expect(ownResponse.status).toBe(201);
  const own = ownResponse.body;
  await expect(admitMediaToken(own.token)).resolves.toBeUndefined();
  expect(
    (
      await req(
        `/rooms/${room.id}/esports/members/${host.id}/seat`,
        host.token,
        { kind: "director" },
      )
    ).status,
  ).toBe(201);
  await expect(admitMediaToken(own.token)).rejects.toThrow();
});

test("audience capacity is independent of player slots and legacy clients cannot see or join esports rooms", async () => {
  const host = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, host.id));
  const room = (
    await req("/rooms", host.token, { name: "容量与兼容", mode: "esports" })
  ).body;
  await req(`/rooms/${room.id}/join`, host.token, {});
  const guests = [];
  for (let i = 0; i < 5; i++) guests.push(await account());
  for (const guest of guests.slice(0, 4))
    expect((await req(`/rooms/${room.id}/join`, guest.token, {})).status).toBe(
      201,
    );
  expect(
    (await req(`/rooms/${room.id}/join`, guests[4]!.token, {})).body.code,
  ).toBe("ESPORTS_SEAT_FULL");
  await req(`/rooms/${room.id}/esports/members/${host.id}/seat`, host.token, {
    kind: "player",
    team: "a",
  });
  expect(
    (await req(`/rooms/${room.id}/join`, guests[4]!.token, {})).status,
  ).toBe(201);
  const oldList = await req("/rooms", host.token, undefined, "GET", "");
  expect(oldList.body.items.some((r: { id: string }) => r.id === room.id)).toBe(
    false,
  );
  expect(
    (await req(`/rooms/${room.id}/join`, host.token, {}, "POST", "")).body.code,
  ).toBe("FEATURE_UPDATE_REQUIRED");
  expect(
    (await req("/rooms", host.token)).body.items.find(
      (r: { id: string }) => r.id === room.id,
    )?.mode,
  ).toBe("esports");
}, 30000);

test("warm timeout, device takeover and explicit leave revoke every child scope", async () => {
  const host = await account(),
    viewer = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, host.id));
  const room = (
    await req("/rooms", host.token, { name: "生命周期", mode: "esports" })
  ).body;
  await req(`/rooms/${room.id}/join`, host.token, {});
  await req(`/rooms/${room.id}/esports/members/${host.id}/seat`, host.token, {
    kind: "player",
    team: "a",
  });
  const lease = (
    await req(`/rooms/${room.id}/esports/share-lease`, host.token, {})
  ).body;
  await req(`/rooms/${room.id}/join`, viewer.token, {});
  const warm = (
    await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
      action: "select",
      publicationId: lease.publicationId,
      revision: 0,
    })
  ).body;
  const video = (
    await req(`/rooms/${room.id}/esports/connection`, viewer.token, {
      channel: { kind: "video", publicationId: lease.publicationId },
      seatRevision: 1,
    })
  ).body;
  const { admitMediaToken } = await import(
    "../../apps/api/src/esports-admission"
  );
  const { esportsWatches } = await import("@cinegather/database");
  await db
    .update(esportsWatches)
    .set({ warmDeadline: new Date(Date.now() - 1) })
    .where(
      and(
        eq(esportsWatches.roomId, room.id),
        eq(esportsWatches.userId, viewer.id),
      ),
    );
  await expect(admitMediaToken(video.token)).rejects.toThrow();
  expect(
    (
      await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
        action: "commit",
        publicationId: lease.publicationId,
        revision: warm.watch.revision,
      })
    ).status,
  ).toBe(409);
  const refreshed = (await req(`/rooms/${room.id}/esports`, viewer.token)).body;
  expect(refreshed.watch.warming).toBeNull();
  const cancelled = await req(`/rooms/${room.id}/esports/watch`, viewer.token, {
    action: "cancel",
    publicationId: lease.publicationId,
    revision: warm.watch.revision,
  });
  expect(cancelled.status).toBe(201);
  expect(cancelled.body.watch.warming).toBeNull();
  const voice = (
    await req(`/rooms/${room.id}/esports/connection`, host.token, {
      channel: { kind: "team", team: "a" },
      seatRevision: 2,
    })
  ).body;
  const [user] = await db.select().from(users).where(eq(users.id, host.id));
  const login = (
    await req("/accounts/login", undefined, {
      username: user!.username,
      password: "Esports isolation test 123!",
    })
  ).body;
  expect(
    (await req(`/rooms/${room.id}/join`, login.sessionToken, {})).status,
  ).toBe(201);
  await expect(admitMediaToken(voice.token)).rejects.toThrow();
  expect((await req(`/rooms/${room.id}/esports`, host.token)).status).toBe(403);
  const next = (await req(`/rooms/${room.id}/esports`, login.sessionToken))
    .body;
  expect(next.self.seat).toEqual({ kind: "player", team: "a" });
  const newVoice = (
    await req(`/rooms/${room.id}/esports/connection`, login.sessionToken, {
      channel: { kind: "team", team: "a" },
      seatRevision: next.self.revision,
    })
  ).body;
  await expect(admitMediaToken(newVoice.token)).resolves.toBeUndefined();
  expect(
    (await req(`/rooms/${room.id}/leave`, login.sessionToken, {})).status,
  ).toBe(201);
  await expect(admitMediaToken(newVoice.token)).rejects.toThrow();
});

test("public RTC validation enforces admission and rejects a cached voice token after a seat change", async () => {
  const owner = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = (
    await req("/rooms", owner.token, { name: "真实网关验证", mode: "esports" })
  ).body;
  const joined = (await req(`/rooms/${room.id}/join`, owner.token, {})).body;
  expect(
    (
      await fetch(
        "http://127.0.0.1:17882/rtc/validate?access_token=" +
          encodeURIComponent(joined.token),
      )
    ).status,
  ).toBe(200);
  const voice = (
    await req(`/rooms/${room.id}/esports/connection`, owner.token, {
      channel: { kind: "audience" },
      seatRevision: 1,
    })
  ).body;
  expect(
    (
      await fetch(
        "http://127.0.0.1:17882/rtc/validate?access_token=" +
          encodeURIComponent(voice.token),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await req(
        `/rooms/${room.id}/esports/members/${owner.id}/seat`,
        owner.token,
        { kind: "player", team: "a" },
      )
    ).status,
  ).toBe(201);
  for (const path of ["/rtc", "/rtc/validate", "/rtc/v1", "/rtc/v1/validate"])
    expect(
      (
        await fetch(
          "http://127.0.0.1:17882" +
            path +
            "?access_token=" +
            encodeURIComponent(voice.token),
        )
      ).status,
    ).toBe(403);
  expect(
    (
      await fetch(origin + "/api/v1/internal/esports-admission", {
        headers: { Authorization: "Bearer " + joined.token },
      })
    ).status,
  ).toBe(401);
});

test("account-bound seat invitations bypass a full audience, mobile rejects unsupported seats and consumes no invitation", async () => {
  const owner = await account(),
    mobile = await account("android"),
    invited = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = (
    await req("/rooms", owner.token, {
      name: "定向席位",
      mode: "esports",
      access: "password",
      password: "match-secret",
    })
  ).body;
  await req(`/rooms/${room.id}/join`, owner.token, {});
  for (let i = 0; i < 4; i++) {
    const a = await account();
    expect(
      (
        await req(`/rooms/${room.id}/join`, a.token, {
          password: "match-secret",
        })
      ).status,
    ).toBe(201);
  }
  expect(
    (
      await req(`/rooms/${room.id}/join`, invited.token, {
        password: "match-secret",
      })
    ).body.code,
  ).toBe("ESPORTS_SEAT_FULL");
  for (const target of [mobile, invited]) {
    const invitation = await req(
      `/rooms/${room.id}/friend-invitations`,
      owner.token,
      { userId: target.id, seat: { kind: "player", team: "a" } },
    );
    expect(invitation.status).toBe(201);
    const inbox = (await req("/friends", target.token)).body.roomInvitations;
    const invite = inbox.find(
      (i: { id: string }) => i.id === invitation.body.id,
    );
    expect(invite.seat).toEqual({ kind: "player", team: "a" });
    const joined = await req(`/rooms/${room.id}/join`, target.token, {
      inviteToken: invite.token,
    });
    if (target === mobile) {
      expect(joined.body.code).toBe("ESPORTS_MOBILE_AUDIENCE_ONLY");
      const [unused] = await db
        .select()
        .from(invites)
        .where(eq(invites.id, invite.id));
      expect(unused!.useCount).toBe(0);
    } else {
      expect(joined.status).toBe(201);
      expect(
        (await req(`/rooms/${room.id}/esports`, target.token)).body.self.seat,
      ).toEqual({ kind: "player", team: "a" });
    }
  }
}, 30000);

test("abnormal player disconnect reserves the seat for two minutes, while explicit leave releases and an empty room closes", async () => {
  const owner = await account(),
    guest = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = (
    await req("/rooms", owner.token, { name: "断线保留", mode: "esports" })
  ).body;
  await req(`/rooms/${room.id}/join`, owner.token, {});
  await req(`/rooms/${room.id}/join`, guest.token, {});
  await req(`/rooms/${room.id}/esports/members/${owner.id}/seat`, owner.token, {
    kind: "player",
    team: "b",
  });
  const { reconcileRoom } = await import("../../apps/api/src/rooms");
  await reconcileRoom(room.id, owner.id);
  const [seat] = await db
    .select()
    .from(esportsSeats)
    .where(
      and(eq(esportsSeats.roomId, room.id), eq(esportsSeats.userId, owner.id)),
    );
  expect(seat!.reservedUntil!.getTime() - Date.now()).toBeGreaterThan(115000);
  expect((await req(`/rooms/${room.id}/join`, owner.token, {})).status).toBe(
    201,
  );
  expect(
    (await req(`/rooms/${room.id}/esports`, owner.token)).body.self.seat,
  ).toEqual({ kind: "player", team: "b" });
  expect((await req(`/rooms/${room.id}/leave`, owner.token, {})).status).toBe(
    201,
  );
  expect(
    await db
      .select()
      .from(esportsSeats)
      .where(
        and(
          eq(esportsSeats.roomId, room.id),
          eq(esportsSeats.userId, owner.id),
        ),
      ),
  ).toHaveLength(0);
  expect((await req(`/rooms/${room.id}/leave`, guest.token, {})).status).toBe(
    201,
  );
  const [closed] = await db.select().from(rooms).where(eq(rooms.id, room.id));
  expect(closed!.status).toBe("closed");
  expect(
    await db
      .select()
      .from(esportsSeats)
      .where(eq(esportsSeats.roomId, room.id)),
  ).toHaveLength(0);
});

test("native publications are independent per player: stopping one leaves the other's WHIP key and video room intact", async () => {
  const owner = await account(),
    player = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = (
    await req("/rooms", owner.token, { name: "多路原生推流", mode: "esports" })
  ).body;
  await req(`/rooms/${room.id}/join`, owner.token, {});
  await req(`/rooms/${room.id}/join`, player.token, {});
  const leases = [];
  for (const [user, team] of [
    [owner, "a"],
    [player, "b"],
  ] as const) {
    await req(
      `/rooms/${room.id}/esports/members/${user.id}/seat`,
      owner.token,
      { kind: "player", team },
    );
    const lease = (
      await req(`/rooms/${room.id}/esports/share-lease`, user.token, {})
    ).body;
    const browser = (
      await req(`/rooms/${room.id}/esports/connection`, user.token, {
        channel: { kind: "video", publicationId: lease.publicationId },
        seatRevision: 2,
      })
    ).body;
    const { admitMediaToken } = await import(
      "../../apps/api/src/esports-admission"
    );
    await expect(admitMediaToken(browser.token)).resolves.toBeUndefined();
    const native = await req(
      `/rooms/${room.id}/esports/share-lease/native`,
      user.token,
      { leaseId: lease.leaseId, revision: lease.revision, systemAudio: true },
    );
    expect(native.status).toBe(201);
    const { nativePublicationSchema } = await import("@cinegather/contracts");
    expect(nativePublicationSchema.safeParse(native.body).success).toBe(true);
    await expect(admitMediaToken(browser.token)).rejects.toThrow();
    expect(native.body.token.length).toBeGreaterThan(8);
    leases.push({ user, lease, native: native.body });
  }
  expect(leases[0]!.native.token).not.toBe(leases[1]!.native.token);
  expect(
    (
      await req(
        `/rooms/${room.id}/esports/share-lease`,
        owner.token,
        {
          leaseId: leases[0]!.lease.leaseId,
          revision: leases[0]!.lease.revision,
        },
        "DELETE",
      )
    ).status,
  ).toBe(200);
  const { esportsPublications } = await import("@cinegather/database");
  const [remaining] = await db
    .select()
    .from(esportsPublications)
    .where(eq(esportsPublications.roomId, room.id));
  expect(remaining!.userId).toBe(player.id);
  const { media } = await import("../../apps/api/src/media");
  const [ingress] = await media.ingress.listIngress({
    ingressId: remaining!.ingressId!,
  });
  expect(ingress!.streamKey).toBe(leases[1]!.native.token);
});

test("admission lock lasts until the SFU join acknowledgment so seat revocation cannot race an accepted handshake", async () => {
  const owner = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = (
    await req("/rooms", owner.token, { name: "信令并发闸门", mode: "esports" })
  ).body;
  await req(`/rooms/${room.id}/join`, owner.token, {});
  const voice = (
    await req(`/rooms/${room.id}/esports/connection`, owner.token, {
      channel: { kind: "audience" },
      seatRevision: 1,
    })
  ).body;
  let release!: () => void,
    entered = false,
    changed = false;
  const acknowledged = new Promise<void>((r) => (release = r));
  const { admitMediaToken } = await import(
    "../../apps/api/src/esports-admission"
  );
  const pending = admitMediaToken(voice.token, async () => {
    entered = true;
    await acknowledged;
  });
  try {
    await Bun.sleep(20);
    expect(entered).toBe(true);
    const edit = req(
      `/rooms/${room.id}/esports/members/${owner.id}/seat`,
      owner.token,
      { kind: "director" },
    ).then((r) => {
      changed = true;
      return r;
    });
    await Bun.sleep(20);
    expect(changed).toBe(false);
    release();
    await pending;
    expect((await edit).status).toBe(201);
    await expect(admitMediaToken(voice.token)).rejects.toThrow();
  } finally {
    release();
    await pending.catch(() => {});
  }
});

test("the production WebSocket relay receives a genuine SFU join response while preserving control-only permissions", async () => {
  const owner = await account();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = (
    await req("/rooms", owner.token, { name: "真实信令入场", mode: "esports" })
  ).body;
  const join = (await req(`/rooms/${room.id}/join`, owner.token, {})).body;
  const { SignalResponse } = await import("@livekit/protocol");
  const response = await new Promise<InstanceType<typeof SignalResponse>>(
    (resolve, reject) => {
      const ws = new WebSocket(
        "ws://127.0.0.1:17882/rtc?protocol=15&sdk=js&version=2.23.0&auto_subscribe=0&access_token=" +
          encodeURIComponent(join.token),
      );
      ws.binaryType = "arraybuffer";
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("SFU join not received"));
      }, 4000);
      ws.onmessage = (event) => {
        try {
          const message = SignalResponse.fromBinary(new Uint8Array(event.data));
          if (message.message.case === "join") {
            clearTimeout(timeout);
            ws.close();
            resolve(message);
          }
        } catch (error) {
          clearTimeout(timeout);
          ws.close();
          reject(error);
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Gateway signalling failed"));
      };
    },
  );
  const { admitMediaToken } = await import(
    "../../apps/api/src/esports-admission"
  );
  await req(`/rooms/${room.id}/esports/members/${owner.id}/seat`, owner.token, {
    kind: "director",
  });
  await expect(admitMediaToken(join.token)).resolves.toBeUndefined();
  expect(response.message.case).toBe("join");
  if (response.message.case !== "join") throw Error("Missing join response");
  expect(response.message.value.room!.name).toBe(room.id);
  expect(response.message.value.participant!.permission).toMatchObject({
    canPublish: false,
    canSubscribe: false,
  });
});
