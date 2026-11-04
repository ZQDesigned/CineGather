import type { Request, Response, NextFunction } from "express";
import {
  gameAuthority,
  gameAccessToken,
  equalSecret,
  validateGameTunnelHook,
} from "./game-tunnel-auth";
const identity = "/api/v1/game-tunnel/identity";
function basic(req: Request) {
  const auth = req.get("Authorization");
  if (!auth?.startsWith("Basic ") || auth.length > 1024) return;
  const raw = Buffer.from(auth.slice(6), "base64").toString();
  const i = raw.indexOf(":");
  if (i < 1) return;
  return { id: raw.slice(0, i), secret: raw.slice(i + 1) };
}
const buckets = new Map<string, { at: number; count: number }>();
/** Metadata/token routes are independent of the interactive account/version guard. */
export async function gameTunnelHttp(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    req.path !== "/api/v1/internal/game-tunnel" &&
    !req.path.startsWith(identity + "/")
  ) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const authority = gameAuthority();
    if (req.path === "/api/v1/internal/game-tunnel") {
      const remote = req.socket.remoteAddress,
        auth = basic(req);
      if (
        req.method !== "POST" ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? "") ||
        auth?.id !== "game" ||
        !equalSecret(auth.secret, authority.settings.pluginSecret)
      ) {
        res.status(403).json({ reject: true, reject_reason: "Forbidden" });
        return;
      }
      res.json(await validateGameTunnelHook(req.body));
      return;
    }
    const now = Date.now(),
      key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    for (const [key, b] of buckets) if (b.at < now - 60000) buckets.delete(key);
    const bucket = buckets.get(key) ?? { at: now, count: 0 };
    if ((!buckets.has(key) && buckets.size >= 10000) || ++bucket.count > 600) {
      res.status(429).json({ error: "temporarily_unavailable" });
      return;
    }
    buckets.set(key, bucket);
    if (
      req.method === "GET" &&
      req.path === identity + "/.well-known/openid-configuration"
    ) {
      res.json(authority.discovery());
      return;
    }
    if (req.method === "GET" && req.path === identity + "/jwks") {
      res.json(authority.jwks());
      return;
    }
    if (req.method === "POST" && req.path === identity + "/token") {
      const auth = basic(req),
        body = req.body as Record<string, unknown>;
      if (!body || body.grant_type !== "client_credentials") {
        res.status(400).json({ error: "unsupported_grant_type" });
        return;
      }
      const id = auth?.id ?? body.client_id,
        secret = auth?.secret ?? body.client_secret;
      if (
        typeof id !== "string" ||
        typeof secret !== "string" ||
        secret.length > 128 ||
        typeof body.audience !== "string"
      ) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }
      res.json(await gameAccessToken(id, secret, body.audience));
      return;
    }
    res.status(404).json({ error: "not_found" });
  } catch {
    res.status(req.path.endsWith("/token") ? 401 : 503).json({
      error: req.path.endsWith("/token")
        ? "invalid_client"
        : "temporarily_unavailable",
    });
  }
}
