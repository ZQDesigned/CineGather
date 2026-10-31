import { dirname } from "node:path";
import type { Request, Response } from "express";
import { MobileUpdateStore } from "./mobile-update-store";
export function serveMobileUpdate(
  store: MobileUpdateStore,
  req: Request,
  res: Response,
) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const channel = String(
      req.query.channel ?? req.get("X-CineGather-Channel") ?? "stable",
    );
    const platform = String(
      req.query.platform ?? req.get("expo-platform") ?? "",
    );
    const runtime = String(
      req.query.runtime ?? req.get("expo-runtime-version") ?? "unknown",
    );
    if (req.path === "/api/v1/mobile-updates/policy") {
      const policy = store.policy(platform, channel, runtime, true);
      return policy ? res.json(policy) : res.status(204).end();
    }
    if (req.path === "/api/v1/mobile-updates/manifest") {
      const accept = req.get("Accept") ?? "*/*";
      res.set({
        "expo-protocol-version": "1",
        "expo-sfv-version": "0",
        Vary: "expo-platform, expo-runtime-version, X-CineGather-Channel, Accept",
      });
      if (req.get("expo-protocol-version") !== "1")
        return res.status(406).end();
      const update = store.manifest(platform, channel, runtime);
      if (!update)
        return res
          .status(
            accept.includes("multipart/mixed") || accept.includes("*/*")
              ? 204
              : 406,
          )
          .end();
      if (
        !["application/json", "application/expo+json", "*/*"].some((type) =>
          accept.includes(type),
        )
      )
        return res.status(406).end();
      res.set({
        "expo-signature": `sig="${update.signature}", keyid="main", alg="rsa-v1_5-sha256"`,
        "Content-Type": "application/expo+json",
      });
      return res.send(update.manifest);
    }
    const asset = /^\/api\/v1\/mobile-updates\/assets\/([a-f0-9]{64})$/.exec(
      req.path,
    );
    if (asset) {
      res.set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "application/octet-stream",
      });
      return res.sendFile(
        asset[1]!,
        { dotfiles: "deny", root: dirname(store.assetPath(asset[1]!)) },
        (error) => {
          if (error && !res.headersSent)
            res.status(404).setHeader("Cache-Control", "no-store").end();
        },
      );
    }
    return res.status(404).end();
  } catch {
    return res.status(503).setHeader("Retry-After", "60").end();
  }
}
