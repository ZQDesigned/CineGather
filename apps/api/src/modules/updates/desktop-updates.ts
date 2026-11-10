import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import {
  desktopRuntimeSchema,
  type DesktopPolicy,
  type FeatureId,
} from "@cinegather/contracts";
import {
  verifyDocument,
  desktopUpdatePublicKey,
} from "@cinegather/update-core";
export class DesktopUpdateStore {
  private verified = new Map<string, { raw: string; policy: DesktopPolicy }>();
  constructor(
    readonly directory: string,
    private key = desktopUpdatePublicKey,
  ) {}
  policy(platform: unknown, arch: unknown, runtime: unknown) {
    const identity = desktopRuntimeSchema.safeParse({
      platform,
      arch,
      runtime,
    });
    if (!identity.success) return;
    const file = join(
      this.directory,
      "desktop-ui/policies",
      `${platform}-${arch}`,
      `${runtime}.json`,
    );
    try {
      if (statSync(file).size > 256 * 1024) throw new Error("Policy too large");
      const raw = readFileSync(file, "utf8");
      const value = {
        raw,
        policy: verifyDocument(raw, this.key, "policy", identity.data),
      };
      this.verified.set(file, value);
      return value;
    } catch (e) {
      if (this.verified.has(file)) return this.verified.get(file);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
}
export function serveDesktopUpdate(
  store: DesktopUpdateStore,
  req: Request,
  res: Response,
) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.path === "/api/v1/desktop-updates/policy") {
      const value = store.policy(
        req.query.platform,
        req.query.arch,
        req.query.runtime,
      );
      return value
        ? res.type("application/json").send(value.raw)
        : res.status(204).end();
    }
    const match =
      /^\/api\/v1\/desktop-updates\/(manifests|assets)\/([a-f0-9]{64})(\.json|\.gz)$/.exec(
        req.path,
      );
    if (
      !match ||
      (match[1] === "manifests" ? match[3] !== ".json" : match[3] !== ".gz")
    )
      return res.status(404).end();
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type":
        match[1] === "manifests"
          ? "application/json"
          : "application/octet-stream",
    });
    return res.sendFile(
      match[2]! + match[3]!,
      {
        root: join(store.directory, "desktop-ui", match[1]!),
        dotfiles: "deny",
      },
      (e) => {
        if (e && !res.headersSent)
          res.status(404).setHeader("Cache-Control", "no-store").end();
      },
    );
  } catch {
    return res.status(503).setHeader("Retry-After", "60").end();
  }
}
// Only new business entry is gated. Cleanup, current media, renewals, chat and activity
// operations retain their existing protocol handlers and authorization checks.
export function desktopEntryFeatures(
  method: string,
  path: string,
  raw: unknown = {},
): FeatureId[] | undefined {
  if (method !== "POST") return;
  const body =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (path === "/api/v1/rooms")
    return [
      body.mode === "esports" ? "room.esports" : "room.standard",
      ...(Number(body.maxMembers) > 10 ? ["room.large" as const] : []),
    ];
  if (/^\/api\/v1\/rooms\/[^/]+\/(?:join|join-admission)$/.test(path))
    return ["room.standard", "room.esports", "room.large"];
  if (path === "/api/v1/games")
    return [
      body.game === "stardew-valley"
        ? "game.stardew-valley"
        : "game.minecraft-java",
    ];
  if (
    /^\/api\/v1\/games\/(?:[^/]+\/(?:requests|transport)|invitations\/[^/]+\/accept)$/.test(
      path,
    )
  )
    return ["game.minecraft-java", "game.stardew-valley"];
  return;
}
export function desktopEntryRequired(
  policy: DesktopPolicy,
  revision: unknown,
  features: FeatureId[],
  existing = false,
) {
  const parsed =
    typeof revision === "string" && /^\d{1,10}$/.test(revision)
      ? Number(revision)
      : -1;
  const minimum = Math.max(
    policy.minimumRevision,
    ...features.map((f) => policy.featureMinimums[f] ?? 0),
  );
  return !existing && parsed < minimum ? minimum : undefined;
}
