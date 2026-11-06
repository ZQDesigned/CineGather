import { expect, test } from "bun:test";
import { alignGameAuthorization } from "../src/game-authorization";
import type { GameTunnelConfig } from "@cinegather/contracts";
const server = Date.parse("2026-11-06T05:19:36.268Z");
function config(): GameTunnelConfig {
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    sessionId: id,
    memberId: id,
    clientId: id,
    clientSecret: "x".repeat(43),
    revision: 1,
    role: "host",
    expiresAt: new Date(server + 30000).toISOString(),
    server: {
      host: "games.example.test",
      port: 443,
      tlsName: "games.example.test",
      stunServer: "games.example.test:3478",
      issuer: "https://api.example.test/api/v1/game-tunnel/identity",
      audience: "cinegather-game",
    },
    peers: [
      {
        memberId: "22222222-2222-4222-8222-222222222222",
        publisherId: id,
        visitorId: "22222222-2222-4222-8222-222222222222",
        revision: 1,
        secret: "y".repeat(43),
        expiresAt: new Date(server + 15000).toISOString(),
      },
    ],
  };
}
for (const skew of [-3500, 120000, -86400000])
  test(`server authorization survives a client clock offset of ${skew}ms without extending its duration`, () => {
    const raw = config(),
      receivedAtMs = server + skew;
    const aligned = alignGameAuthorization(raw, {
      serverTimeMs: server,
      receivedAtMs,
      roundTripMs: 450,
    });
    expect(Date.parse(aligned.expiresAt) - receivedAtMs).toBe(29550);
    expect(Date.parse(aligned.peers[0]!.expiresAt) - receivedAtMs).toBe(14550);
    expect(raw.expiresAt).toBe("2026-11-06T05:20:06.268Z");
    expect(aligned.clientSecret).toBe(raw.clientSecret);
  });
test("network delay cannot revive expired authorization or fabricate missing clock information", () => {
  expect(() =>
    alignGameAuthorization(config(), {
      serverTimeMs: server + 30000,
      receivedAtMs: server,
      roundTripMs: 1,
    }),
  ).toThrow();
  expect(() =>
    alignGameAuthorization(config(), {
      serverTimeMs: NaN,
      receivedAtMs: server,
      roundTripMs: 1,
    }),
  ).toThrow();
});

test("an already expired peer is removed for hosts and cannot be used by guests", () => {
  const raw = config();
  raw.peers[0]!.expiresAt = new Date(server + 100).toISOString();
  const clock = {
    serverTimeMs: server,
    receivedAtMs: server - 3500,
    roundTripMs: 450,
  };
  expect(alignGameAuthorization(raw, clock).peers).toEqual([]);
  expect(() =>
    alignGameAuthorization({ ...raw, role: "guest" }, clock),
  ).toThrow();
});
