import { describe, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";

describe("reverse proxy authentication rate limits", () => {
  async function exercise(trustedProxies: string[], separateClients: boolean) {
    const app = await createApp({ trustedProxies });
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const login = (address: string) =>
      fetch(`${origin}/api/v1/accounts/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": address,
        },
        body: "{}",
      });
    try {
      for (let i = 0; i < 60; i++) {
        const response = await login("198.51.100.1");
        expect(response.status).toBe(400);
        await response.arrayBuffer();
      }
      const blocked = await login("198.51.100.1");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).not.toBeNull();
      await blocked.arrayBuffer();
      const other = await login("198.51.100.2");
      expect(other.status).toBe(separateClients ? 400 : 429);
      await other.arrayBuffer();
    } finally {
      await app.close();
    }
  }

  test("trusted loopback proxy preserves independent user rate limits", () =>
    exercise(["loopback"], true));
  test("forwarded addresses from an untrusted peer cannot bypass limits", () =>
    exercise(["192.0.2.0/24"], false));
  test("proxy trust is disabled by default", () => exercise([], false));
});

// The origin overwrites X-Forwarded-For with the TCP/PROXY-protocol peer.
// Only a trusted origin proxy AND a known CDN peer may assert EO-Connecting-IP.
test("CDN clients sharing one origin peer have independent login buckets", async () => {
  const app = await createApp({
    trustedProxies: ["loopback"],
    trustedCdns: ["192.0.2.0/24"],
  });
  await app.listen(0, "127.0.0.1");
  try {
    const base = await app.getUrl();
    const login = async (ip: string, peer = "192.0.2.7") => {
      const r = await fetch(base + "/api/v1/accounts/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": peer,
          "EO-Connecting-IP": ip,
        },
        body: "{}",
      });
      await r.arrayBuffer();
      return r.status;
    };
    for (let i = 0; i < 60; i++) expect(await login("198.51.100.1")).toBe(400);
    expect(await login("198.51.100.1")).toBe(429);
    expect(await login("198.51.100.2")).toBe(400);
    expect(await login("2001:db8::1")).toBe(400);
    for (let i = 0; i < 60; i++)
      expect(await login("203.0.113.1", "198.51.100.9")).toBe(400);
    expect(await login("203.0.113.2", "198.51.100.9")).toBe(429);
  } finally {
    await app.close();
  }
});

test("verified accounts behind one NAT have independent API quotas; invalid bearer remains unauthenticated", async () => {
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  const origin = await app.getUrl(),
    created: string[] = [];
  try {
    const tokens: string[] = [];
    for (let n = 0; n < 2; n++) {
      const r = await fetch(origin + "/api/v1/accounts/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username:
            "nat_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
          displayName: "同网测试",
          password: "NAT test account 123!",
        }),
      });
      expect(r.status).toBe(201);
      const body = await r.json();
      tokens.push(body.sessionToken);
      created.push(body.user.id);
    }
    const get = async (token: string) => {
      const r = await fetch(origin + "/api/v1/me", {
        headers: { Authorization: "Bearer " + token },
      });
      await r.arrayBuffer();
      return r;
    };
    for (let i = 0; i < 350; i++)
      for (const token of tokens) expect((await get(token)).status).toBe(200);
    for (let i = 350; i < 600; i++)
      expect((await get(tokens[0]!)).status).toBe(200);
    const blocked = await get(tokens[0]!);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    expect((await get(tokens[1]!)).status).toBe(200);
    expect((await get("not-a-credential")).status).toBe(401);
  } finally {
    await app.close();
    const { db } = await import("../../apps/api/src/core/context"),
      { users, credentials, auditLogs, idempotency } = await import(
        "@cinegather/database"
      ),
      { inArray } = await import("drizzle-orm");
    if (created.length) {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, created));
      await db.delete(idempotency).where(inArray(idempotency.userId, created));
      await db.delete(credentials).where(inArray(credentials.userId, created));
      await db.delete(users).where(inArray(users.id, created));
    }
  }
}, 30_000);
