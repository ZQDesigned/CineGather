import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp, openapi } from "../../apps/api/src/app";
import {
  createDatabase,
  credentials,
  invites,
  users,
  rooms,
  members,
  bans,
  messages,
  friendships,
  auditLogs,
  idempotency,
} from "@cinegather/database";
import { eq, inArray, or } from "drizzle-orm";
import { AccessToken } from "livekit-server-sdk";
import { createHash } from "node:crypto";
import type { RoomInfo } from "@cinegather/contracts";
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const createdUsers: string[] = [];
async function req(
  path: string,
  token?: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  key?: string,
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function account(name = "集成测试") {
  const r = await req("/accounts/register", undefined, {
    displayName: name,
    username: `it_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    password: "Integration account 123!",
  });
  expect(r.status).toBe(201);
  createdUsers.push(r.body.user.id);
  await db
    .update(users)
    .set({ screenShareEnabled: true })
    .where(eq(users.id, r.body.user.id));
  return { id: r.body.user.id as string, token: r.body.sessionToken as string };
}
async function room(token: string, maxMembers = 5, key?: string) {
  const r = await req(
    "/rooms",
    token,
    { name: "测试放映室", maxMembers },
    "POST",
    key,
  );
  expect(r.status).toBe(201);
  return r.body as RoomInfo;
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  if (createdUsers.length)
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(inArray(messages.userId, createdUsers));
      await tx
        .delete(friendships)
        .where(
          or(
            inArray(friendships.requesterId, createdUsers),
            inArray(friendships.recipientId, createdUsers),
          ),
        );
      await tx.delete(bans).where(inArray(bans.userId, createdUsers));
      await tx.delete(members).where(inArray(members.userId, createdUsers));
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, createdUsers));
      await tx
        .delete(auditLogs)
        .where(inArray(auditLogs.actorId, createdUsers));
      await tx
        .delete(idempotency)
        .where(inArray(idempotency.userId, createdUsers));
      await tx
        .delete(credentials)
        .where(inArray(credentials.userId, createdUsers));
      await tx.delete(users).where(inArray(users.id, createdUsers));
    });
  await pool.end();
});

describe("real PostgreSQL and LiveKit API boundaries", () => {
  test("normal rooms admit new accounts by public code and preserve a single canonical media room", async () => {
    const a = await account();
    const b = await account();
    const r = await room(a.token);
    expect(r.code).toMatch(/^[A-F0-9]{8}$/);
    expect(r.access).toBe("normal");
    const joined = await req(
      `/rooms/${r.code.toLowerCase()}/join`,
      b.token,
      {},
    );
    expect(joined.status).toBe(201);
    expect(joined.body.room).toMatchObject({
      id: r.id,
      code: r.code,
      access: "normal",
      role: "member",
    });
    const claims = JSON.parse(
      Buffer.from(joined.body.token.split(".")[1], "base64url").toString(),
    );
    expect(claims.video.room).toBe(r.id);
    const [stored] = await db.select().from(rooms).where(eq(rooms.id, r.id));
    expect(stored?.passwordHash).toBeNull();
    await req(`/rooms/${r.id}/leave`, b.token, {});
  });
  test("password rooms verify on every manual admission, owners and valid invitations can enter without passwords", async () => {
    const a = await account();
    const b = await account();
    const c = await account();
    const password = " only-in-memory-123 ";
    const key = crypto.randomUUID();
    const created = await req(
      "/rooms",
      a.token,
      { name: "加密放映室", access: "password", password },
      "POST",
      key,
    );
    expect(created.status).toBe(201);
    const r = created.body as RoomInfo;
    expect(r.access).toBe("password");
    expect(created.body.passwordHash).toBeUndefined();
    expect(created.body.password).toBeUndefined();
    const [stored] = await db.select().from(rooms).where(eq(rooms.id, r.id));
    expect(stored?.passwordHash).toStartWith("scrypt-v1$");
    expect(stored?.passwordHash).not.toContain(password);
    expect((await req(`/rooms/${r.code}/join`, b.token, {})).body.code).toBe(
      "ROOM_PASSWORD_REQUIRED",
    );
    expect(
      (await req(`/rooms/${r.id}/join`, b.token, { password: password.trim() }))
        .body.code,
    ).toBe("ROOM_PASSWORD_INVALID");
    expect(
      (await req(`/rooms/${r.code}/join`, b.token, { password })).status,
    ).toBe(201);
    await req(`/rooms/${r.id}/leave`, b.token, {});
    expect((await req(`/rooms/${r.code}/join`, b.token, {})).body.code).toBe(
      "ROOM_PASSWORD_REQUIRED",
    );
    expect((await req(`/rooms/${r.code}/join`, a.token, {})).status).toBe(201);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {
      maxUses: 1,
    });
    expect(
      (
        await req(`/rooms/${r.code}/join`, c.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(201);
    await req(`/rooms/${r.id}/leave`, c.token, {});
    expect(
      (
        await req(`/rooms/${r.code}/join`, c.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(201);
    const outsider = await account();
    expect(
      (
        await req(`/rooms/${r.code}/join`, outsider.token, {
          inviteToken: invitation.body.token,
        })
      ).body.code,
    ).toBe("INVITE_INVALID");
    await req(
      `/rooms/${r.id}/invites/${invitation.body.id}`,
      a.token,
      undefined,
      "DELETE",
    );
    expect(
      (
        await req(`/rooms/${r.code}/join`, c.token, {
          inviteToken: invitation.body.token,
          password,
        })
      ).body.code,
    ).toBe("INVITE_INVALID");
    expect(
      (await req(`/rooms/${r.code}/join`, c.token, { password })).status,
    ).toBe(201);
    const listed = await req("/rooms", c.token);
    expect(listed.body.items).toContainEqual({ ...r, role: "member" });
    const [deduplicated] = await db
      .select()
      .from(idempotency)
      .where(eq(idempotency.key, key));
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, r.id));
    expect(
      JSON.stringify([deduplicated, logs, listed.body, created.body]),
    ).not.toContain(password);
    for (const user of [a, c])
      await req(`/rooms/${r.id}/leave`, user.token, {});
  });
  test("encrypted admission preserves capacity, invitation revocation, expiry and bans", async () => {
    const a = await account();
    const b = await account();
    const c = await account();
    const password = "local-123";
    const created = await req("/rooms", a.token, {
      name: "权限边界",
      maxMembers: 2,
      access: "password",
      password,
    });
    const r = created.body as RoomInfo;
    expect(created.status).toBe(201);
    await req(`/rooms/${r.id}/join`, a.token, {});
    await req(`/rooms/${r.code}/join`, b.token, { password });
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {
      maxUses: 1,
    });
    const full = await req(`/rooms/${r.code}/join`, c.token, {
      inviteToken: invitation.body.token,
    });
    expect(full.body.code).toBe("ROOM_FULL");
    const [unused] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, invitation.body.id));
    expect(unused?.useCount).toBe(0);
    const membership = await db
      .select()
      .from(members)
      .where(eq(members.userId, c.id));
    expect(membership).toHaveLength(0);
    await req(`/rooms/${r.id}/leave`, b.token, {});
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, invitation.body.id));
    expect(
      (
        await req(`/rooms/${r.code}/join`, c.token, {
          inviteToken: invitation.body.token,
        })
      ).body.code,
    ).toBe("INVITE_INVALID");
    const fresh = await req(`/rooms/${r.id}/invites`, a.token, {});
    await req(
      `/rooms/${r.id}/members/${c.id}`,
      a.token,
      { ban: true },
      "DELETE",
    );
    expect(
      (await req(`/rooms/${r.code}/join`, c.token, { password })).body.code,
    ).toBe("ROOM_BANNED");
    expect(
      (
        await req(`/rooms/${r.code}/join`, c.token, {
          inviteToken: fresh.body.token,
        })
      ).body.code,
    ).toBe("ROOM_BANNED");
    await req(`/rooms/${r.id}/leave`, a.token, {});
  });
  test("wrong room passwords are rate limited without blocking valid invitations", async () => {
    const a = await account();
    const b = await account();
    const created = await req("/rooms", a.token, {
      name: "尝试次数",
      access: "password",
      password: "local-123",
    });
    const r = created.body as RoomInfo;
    for (let n = 0; n < 8; n++)
      expect(
        (await req(`/rooms/${r.code}/join`, b.token, { password: "wrong" }))
          .body.code,
      ).toBe("ROOM_PASSWORD_INVALID");
    const limited = await req(`/rooms/${r.code}/join`, b.token, {
      password: "local-123",
    });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("ROOM_PASSWORD_RATE_LIMITED");
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {});
    expect(
      (
        await req(`/rooms/${r.code}/join`, b.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(201);
    await req(`/rooms/${r.id}/leave`, b.token, {});
  });
  test("health actually checks database and SFU; anonymous room operations are rejected", async () => {
    expect((await req("/health")).status).toBe(200);
    expect((await req("/rooms", undefined, { name: "forged" })).status).toBe(
      401,
    );
    expect(
      (
        await req("/accounts/register", undefined, {
          username: "invalid",
          displayName: "   ",
          password: "Integration account 123!",
        })
      ).status,
    ).toBe(400);
  });
  test("malformed JSON is a bounded client error with a correlation ID", async () => {
    const response = await fetch(`${base}/api/v1/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"displayName":',
    });
    expect(response.status).toBe(400);
    const error = (await response.json()) as { requestId?: string };
    expect(error.requestId).toMatch(/^[a-f0-9-]{36}$/);
  });
  test("generated OpenAPI exposes defaulted request fields as optional", () => {
    const document = openapi(app);
    const body = document.paths["/api/v1/rooms"]!.post!.requestBody as {
      content: Record<string, { schema: { required: string[] } }>;
    };
    expect(body.content["application/json"]!.schema.required).toEqual(["name"]);
  });
  test("account identity and invite secrets are never stored in plaintext; private rooms do not leak", async () => {
    const a = await account();
    const b = await account();
    const r = await room(a.token);
    const stored = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, a.id));
    expect(stored[0]?.secretHash).not.toBe(a.token);
    expect(stored[0]?.secretHash.length).toBe(64);
    expect((await req(`/rooms/${r.id}`, b.token)).status).toBe(403);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {
      maxUses: 1,
    });
    expect(invitation.status).toBe(201);
    const storedInvite = await db
      .select()
      .from(invites)
      .where(eq(invites.id, invitation.body.id));
    expect(storedInvite[0]?.tokenHash).not.toBe(invitation.body.token);
    const join = await req(`/rooms/${r.id}/join`, b.token, {
      inviteToken: invitation.body.token,
    });
    expect(join.status).toBe(201);
    const claims = JSON.parse(
      Buffer.from(join.body.token.split(".")[1], "base64url").toString(),
    );
    expect(claims.sub).toBe(b.id);
    expect(claims.video.canPublishSources).toEqual(["microphone"]);
    const c = await account();
    expect(
      (
        await req(`/rooms/${r.id}/join`, c.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(403);
    expect((await req(`/rooms/${r.id}/join`, b.token, {})).status).toBe(201);
  });
  test("alternate UUID casing cannot split a business room into multiple media rooms", async () => {
    const a = await account();
    const r = await room(a.token);
    const joined = await req(`/rooms/${r.id.toUpperCase()}/join`, a.token, {});
    expect(joined.status).toBe(201);
    expect(joined.body.room.id).toBe(r.id);
    const claims = JSON.parse(
      Buffer.from(joined.body.token.split(".")[1], "base64url").toString(),
    );
    expect(claims.video.room).toBe(r.id);
    await req(`/rooms/${r.id}/leave`, a.token, {});
  });
  test("idempotency survives retries and rejects using the same key for a different request", async () => {
    const a = await account();
    const key = crypto.randomUUID();
    const first = await room(a.token, 5, key);
    const again = await room(a.token, 5, key);
    expect(again.id).toBe(first.id);
    expect(
      (await req("/rooms", a.token, { name: "另一个房间" }, "POST", key))
        .status,
    ).toBe(409);
  });
  test("parallel joins cannot exceed capacity, and a leave frees its admission", async () => {
    const a = await account();
    const b = await account();
    const c = await account();
    const r = await room(a.token, 2);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {});
    expect((await req(`/rooms/${r.id}/join`, a.token, {})).status).toBe(201);
    const attempts = await Promise.all(
      [b, c].map((p) =>
        req(`/rooms/${r.id}/join`, p.token, {
          inviteToken: invitation.body.token,
        }),
      ),
    );
    expect(attempts.map((x) => x.status).sort()).toEqual([201, 409]);
    expect((await req(`/rooms/${r.id}/leave`, a.token, {})).status).toBe(201);
    const lost = attempts[0]?.status === 409 ? b : c;
    expect(
      (
        await req(`/rooms/${r.id}/join`, lost.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(201);
  });
  test("moderation, chat and invite revocation enforce room membership and owner permissions", async () => {
    const a = await account();
    const b = await account();
    const r = await room(a.token);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {});
    await req(`/rooms/${r.id}/join`, b.token, {
      inviteToken: invitation.body.token,
    });
    expect(
      (
        await req(
          `/rooms/${r.id}/members/${a.id}`,
          b.token,
          { ban: true },
          "DELETE",
        )
      ).status,
    ).toBe(403);
    expect(
      (await req(`/rooms/${r.id}/messages`, b.token, { body: "你好，映聚" }))
        .status,
    ).toBe(201);
    const messages = await req(`/rooms/${r.id}/messages`, a.token);
    expect(
      messages.body.items.some(
        (m: { body: string }) => m.body === "你好，映聚",
      ),
    ).toBe(true);
    expect(
      (
        await req(
          `/rooms/${r.id}/members/${b.id}`,
          a.token,
          { ban: true },
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect((await req(`/rooms/${r.id}/join`, b.token, {})).status).toBe(403);
    expect(
      (await req(`/rooms/${r.id}/messages`, b.token, { body: "forbidden" }))
        .status,
    ).toBe(403);
    expect(
      (
        await req(
          `/rooms/${r.id}/invites/${invitation.body.id}`,
          a.token,
          undefined,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    const c = await account();
    expect(
      (
        await req(`/rooms/${r.id}/join`, c.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(403);
  });
  test("friend requests require recipient acceptance and may be removed by either party", async () => {
    const a = await account();
    const b = await account();
    expect((await req("/friends", a.token, { userId: b.id })).status).toBe(201);
    expect((await req(`/friends/${b.id}/accept`, a.token, {})).status).toBe(
      404,
    );
    expect((await req(`/friends/${a.id}/accept`, b.token, {})).status).toBe(
      201,
    );
    expect((await req("/friends", a.token)).body.items[0].status).toBe(
      "accepted",
    );
    expect(
      (await req(`/friends/${a.id}`, b.token, undefined, "DELETE")).status,
    ).toBe(200);
    expect((await req("/friends", a.token)).body.items).toHaveLength(0);
    const events = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(or(eq(auditLogs.actorId, a.id), eq(auditLogs.actorId, b.id)));
    expect(events.map((e) => e.action)).toContain("friend.accepted");
    expect(events.map((e) => e.action)).toContain("friend.removed");
    expect((await req("/friends", a.token, { userId: a.id })).status).toBe(400);
  });
  test("LiveKit webhook media type preserves the raw body for signature verification", async () => {
    const a = await account();
    const r = await room(a.token);
    const body = JSON.stringify({
      event: "participant_joined",
      room: { name: r.id },
      id: crypto.randomUUID(),
    });
    const access = new AccessToken(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
      { ttl: 60 },
    );
    access.sha256 = createHash("sha256").update(body).digest("base64");
    const signature = await access.toJwt();
    const valid = await fetch(`${base}/api/v1/livekit/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/webhook+json",
        Authorization: signature,
      },
      body,
    });
    expect(valid.status).toBe(200);
    const forged = await fetch(`${base}/api/v1/livekit/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/webhook+json",
        Authorization: signature,
      },
      body: body + " ",
    });
    expect(forged.status).toBe(401);
  });
  test("revoking an account session invalidates its bearer immediately", async () => {
    const a = await account();
    expect((await req("/me", a.token)).status).toBe(200);
    expect((await req("/session", a.token, undefined, "DELETE")).status).toBe(
      200,
    );
    expect((await req("/me", a.token)).status).toBe(401);
    expect(
      await db.select().from(users).where(eq(users.id, a.id)),
    ).toHaveLength(1);
  });
});

test("media token issuance failures are observable without counting rejected invitations", async () => {
  const { media } = await import("../../apps/api/src/media");
  const owner = await account();
  const outsider = await account();
  const target = await room(owner.token);
  const before = await req("/diagnostics", owner.token);
  expect(typeof before.body.tokenIssueFailures).toBe("number");
  expect(
    (
      await req(`/rooms/${target.id}/join`, outsider.token, {
        inviteToken: "x".repeat(43),
      })
    ).status,
  ).toBe(403);
  expect((await req("/diagnostics", owner.token)).body.tokenIssueFailures).toBe(
    before.body.tokenIssueFailures,
  );
  const original = media.issue;
  try {
    media.issue = async () => {
      throw new Error("Controlled token issuance failure");
    };
    expect(
      (await req(`/rooms/${target.id}/join`, owner.token, {})).status,
    ).toBe(503);
    expect(
      (await req("/diagnostics", owner.token)).body.tokenIssueFailures,
    ).toBe(before.body.tokenIssueFailures + 1);
  } finally {
    media.issue = original;
  }
});

test("an unavailable ingress registry cannot prevent expired browser permission revocation", async () => {
  const { media } = await import("../../apps/api/src/media");
  const { reconcileRoom } = await import("../../apps/api/src/rooms");
  const { leases } = await import("@cinegather/database");
  const user = await account("过期授权隔离");
  const created = await room(user.token);
  await db
    .update(leases)
    .set({
      holderUserId: user.id,
      leaseId: crypto.randomUUID(),
      revision: 1,
      expiresAt: new Date(Date.now() - 1000),
    })
    .where(eq(leases.roomId, created.id));
  const list = media.participants,
    set = media.setShare,
    ingressList = media.ingress.listIngress;
  const permissions: boolean[] = [];
  try {
    media.participants = async () =>
      [
        { identity: user.id, permission: { canPublishSources: [2, 3, 4] } },
      ] as Awaited<ReturnType<typeof list>>;
    media.setShare = async (_roomId, _userId, allow) => {
      permissions.push(allow);
    };
    media.ingress.listIngress = async () => {
      throw new Error("registry unavailable");
    };
    await expect(reconcileRoom(created.id)).rejects.toThrow(
      "registry unavailable",
    );
    expect(permissions).toEqual([false]);
  } finally {
    media.participants = list;
    media.setShare = set;
    media.ingress.listIngress = ingressList;
  }
});

test("logout waits for in-flight native issuance and revokes the key committed by that request", async () => {
  const { media } = await import("../../apps/api/src/media");
  const r = await import("../../apps/api/src/rooms");
  const { revokeSession } = await import("../../apps/api/src/auth");
  const user = await account("原生撤销并发");
  const created = await room(user.token);
  const originalList = media.participants,
    originalSet = media.setShare,
    originalCreate = media.createNative;
  let unblock!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let issuance: Promise<unknown> | undefined, logout: Promise<void> | undefined;
  try {
    media.participants = async () =>
      [
        { identity: user.id, permission: { canPublishSources: [2] } },
      ] as Awaited<ReturnType<typeof originalList>>;
    media.setShare = async () => {};
    media.createNative = async (...args) => {
      const value = await originalCreate.apply(media, args);
      reached();
      await gate;
      return value;
    };
    const person = { id: user.id, displayName: "原生撤销并发" };
    const lease = await r.acquireLease(person, created.id);
    issuance = r.nativePublication(person, created.id, lease);
    await entered;
    let loggedOut = false;
    logout = revokeSession(`Bearer ${user.token}`).then(() => {
      loggedOut = true;
    });
    for (let i = 0; i < 50; i++) {
      const [credential] = await db
        .select()
        .from(credentials)
        .where(eq(credentials.userId, user.id));
      if (credential?.revokedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(loggedOut).toBe(false);
    unblock();
    await issuance;
    await logout;
    expect(
      (await media.ingress.listIngress({ roomName: created.id })).length,
    ).toBe(0);
  } finally {
    unblock();
    await issuance?.catch(() => {});
    await logout?.catch(() => {});
    media.participants = originalList;
    media.setShare = originalSet;
    media.createNative = originalCreate;
    for (const entry of await media.ingress.listIngress({
      roomName: created.id,
    }))
      await media.ingress.deleteIngress(entry.ingressId);
  }
});

test("separate ingress creation attempts within one lease cannot revoke each other's publisher identity", async () => {
  const { media } = await import("../../apps/api/src/media");
  const user = await account("推流重试隔离");
  const created = await room(user.token);
  const entries: { ingressId: string; participantIdentity: string }[] = [];
  try {
    const leaseId = crypto.randomUUID();
    entries.push(
      await media.createNative(
        created.id,
        { id: user.id, displayName: "推流重试隔离" },
        leaseId,
      ),
    );
    entries.push(
      await media.createNative(
        created.id,
        { id: user.id, displayName: "推流重试隔离" },
        leaseId,
      ),
    );
    expect(
      entries[0]!.participantIdentity === entries[1]!.participantIdentity,
    ).toBe(false);
  } finally {
    for (const entry of entries)
      await media.ingress.deleteIngress(entry.ingressId);
  }
});

describe("owner room settings", () => {
  test("owner changes name and capacity without replacing room identifiers or invitations", async () => {
    const owner = await account(),
      viewer = await account(),
      stranger = await account();
    const created = await room(owner.token, 2);
    const invitation = await req(
      `/rooms/${created.id}/invites`,
      owner.token,
      {},
    );
    expect(
      (await req(`/rooms/${created.id}/join`, viewer.token, {})).status,
    ).toBe(201);
    const url = `/rooms/${created.id}/settings`;
    expect((await req(url, undefined, { name: "匿名修改" })).status).toBe(401);
    expect((await req(url, viewer.token, { name: "成员修改" })).status).toBe(
      403,
    );
    expect((await req(url, stranger.token, { maxMembers: 10 })).status).toBe(
      403,
    );
    const updated = await req(url, owner.token, {
      name: "  修改后的放映室  ",
      maxMembers: 4,
    });
    expect(updated.status).toBe(201);
    expect(updated.body).toMatchObject({
      id: created.id,
      code: created.code,
      name: "修改后的放映室",
      maxMembers: 4,
      ownerUserId: owner.id,
      access: "normal",
    });
    expect(
      (await req(`/rooms/${created.id}`, viewer.token)).body,
    ).toMatchObject({ name: "修改后的放映室", maxMembers: 4, role: "member" });
    expect(
      (await req("/rooms", viewer.token)).body.items.find(
        (r: RoomInfo) => r.id === created.id,
      ).name,
    ).toBe("修改后的放映室");
    expect(
      (
        await req(`/rooms/${created.id}/join`, stranger.token, {
          inviteToken: invitation.body.token,
        })
      ).status,
    ).toBe(201);
    const { media } = await import("../../apps/api/src/media");
    expect(
      (await media.client.listRooms([created.id]))[0]!.maxParticipants,
    ).toBe(11);
  });
  test("strict settings validation and occupied admission seats prevent invalid or destructive edits", async () => {
    const a = await account(),
      b = await account(),
      c = await account();
    const r = await room(a.token, 5),
      url = `/rooms/${r.id}/settings`;
    for (const body of [
      {},
      { name: " " },
      { name: "x".repeat(65) },
      { maxMembers: 1 },
      { maxMembers: 11 },
      { maxMembers: 2.5 },
      { name: "越权", ownerUserId: b.id },
      { access: "normal" },
    ])
      expect((await req(url, a.token, body)).status).toBe(400);
    await req(`/rooms/${r.id}/join`, b.token, {});
    await req(`/rooms/${r.id}/join`, c.token, {});
    const denied = await req(url, a.token, {
      name: "不应该保存",
      maxMembers: 2,
    });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("ROOM_CAPACITY_TOO_SMALL");
    expect((await req(`/rooms/${r.id}`, a.token)).body.name).toBe(r.name);
    expect((await req(url, a.token, { maxMembers: 3 })).status).toBe(201);
    const extra = await account();
    expect((await req(`/rooms/${r.id}/join`, extra.token, {})).body.code).toBe(
      "ROOM_FULL",
    );
    expect((await req(url, a.token, { name: "只改名称" })).status).toBe(201);
    expect((await req(`/rooms/${r.id}`, a.token)).body.maxMembers).toBe(3);
  });
  test("capacity edits serialize with concurrent admission", async () => {
    const a = await account(),
      b = await account(),
      c = await account();
    const r = await room(a.token, 3);
    await req(`/rooms/${r.id}/join`, b.token, {});
    const [edit, join] = await Promise.all([
      req(`/rooms/${r.id}/settings`, a.token, { maxMembers: 2 }),
      req(`/rooms/${r.id}/join`, c.token, {}),
    ]);
    expect([edit.status, join.status].sort()).toEqual([201, 409]);
    if (edit.status === 201) expect(join.body.code).toBe("ROOM_FULL");
    else expect(edit.body.code).toBe("ROOM_CAPACITY_TOO_SMALL");
  });
  test("legacy media ceilings reject unsupported expansion while keeping rename available", async () => {
    const a = await account();
    const r = await room(a.token, 2);
    const { media } = await import("../../apps/api/src/media");
    await media.client.createRoom({ name: r.id, maxParticipants: 3 });
    const expanded = await req(`/rooms/${r.id}/settings`, a.token, {
      name: "不能保存",
      maxMembers: 5,
    });
    expect(expanded.status).toBe(409);
    expect(expanded.body.code).toBe("ROOM_RECREATE_REQUIRED");
    expect(
      (
        await req(`/rooms/${r.id}/settings`, a.token, {
          name: "旧房间仍可改名",
        })
      ).status,
    ).toBe(201);
    expect((await req(`/rooms/${r.id}`, a.token)).body.maxMembers).toBe(2);
  });
});

test("room settings count each human once and exclude the native screen publisher", async () => {
  const a = await account(),
    b = await account(),
    c = await account();
  const r = await room(a.token, 5);
  await req(`/rooms/${r.id}/join`, b.token, {});
  await req(`/rooms/${r.id}/join`, c.token, {});
  const { media } = await import("../../apps/api/src/media");
  const { nativeIdentity } = await import("@cinegather/contracts");
  const original = media.participants;
  try {
    media.participants = async (id, ...rest) =>
      id === r.id
        ? ([
            { identity: a.id },
            { identity: nativeIdentity(a.id, crypto.randomUUID()) },
          ] as Awaited<ReturnType<typeof original>>)
        : original.call(media, id, ...rest);
    expect(
      (await req(`/rooms/${r.id}/settings`, a.token, { maxMembers: 3 })).status,
    ).toBe(201);
    await db
      .update(members)
      .set({ admittedUntil: new Date(0) })
      .where(eq(members.userId, c.id));
    expect(
      (await req(`/rooms/${r.id}/settings`, a.token, { maxMembers: 2 })).status,
    ).toBe(201);
    media.participants = async (id, ...rest) => {
      if (id === r.id) throw new Error("Synthetic SFU outage");
      return original.call(media, id, ...rest);
    };
    expect(
      (
        await req(`/rooms/${r.id}/settings`, a.token, {
          name: "媒体离线仍可改名",
        })
      ).status,
    ).toBe(201);
  } finally {
    media.participants = original;
  }
});
test("room settings follow ownership transfer and cannot reopen a closed room", async () => {
  const a = await account(),
    b = await account();
  const r = await room(a.token, 4);
  await req(`/rooms/${r.id}/join`, b.token, {});
  expect(
    (
      await req(`/rooms/${r.id}/settings`, a.token, {
        name: "转让前的新名称",
        maxMembers: 5,
      })
    ).status,
  ).toBe(201);
  await req(`/rooms/${r.id}/leave`, a.token, {});
  expect(
    (await req(`/rooms/${r.id}/settings`, a.token, { name: "旧房主" })).status,
  ).toBe(403);
  expect(
    (await req(`/rooms/${r.id}/settings`, b.token, { name: "新房主的名称" }))
      .status,
  ).toBe(201);
  await req(`/rooms/${r.id}/leave`, b.token, {});
  expect(
    (await req(`/rooms/${r.id}/settings`, b.token, { name: "不能重新打开" }))
      .status,
  ).toBe(404);
});
