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
