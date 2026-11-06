import { GAME_LEASE_MS, type GameTunnelConfig } from "@cinegather/contracts";

/** Translate server deadlines to this device's clock, conservatively charging the
 * entire request RTT. Server-side membership/token expiry remains authoritative. */
export function alignGameAuthorization(
  config: GameTunnelConfig,
  clock: { serverTimeMs: number; receivedAtMs: number; roundTripMs: number },
): GameTunnelConfig {
  const { serverTimeMs, receivedAtMs, roundTripMs } = clock;
  if (
    ![serverTimeMs, receivedAtMs, roundTripMs].every(Number.isFinite) ||
    serverTimeMs <= 0 ||
    roundTripMs < 0
  )
    throw Error("无法校准联机授权时间，请稍后重试");
  const deadline = (value: string) =>
    new Date(
      receivedAtMs +
        Math.min(GAME_LEASE_MS, Date.parse(value) - serverTimeMs) -
        roundTripMs,
    ).toISOString();
  const expiresAt = deadline(config.expiresAt);
  if (Date.parse(expiresAt) <= receivedAtMs)
    throw Error("联机授权已过期，请重新连接");
  const peers = config.peers
    .map((peer) => ({ ...peer, expiresAt: deadline(peer.expiresAt) }))
    .filter((peer) => Date.parse(peer.expiresAt) > receivedAtMs);
  if (config.role === "guest" && peers.length !== 1)
    throw Error("联机授权已过期，请重新连接");
  return {
    ...config,
    expiresAt,
    peers,
  };
}
