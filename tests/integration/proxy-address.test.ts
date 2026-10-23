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
