import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  mobilePlatformSchema,
  mobileChannelSchema,
  mobileRuntimeSchema,
  mobileUpdateIndexSchema,
  type MobileUpdateIndex,
} from "@cinegather/contracts";
import { selectMobilePolicy } from "./mobile-updates";
const envelopeSchema = z
  .object({
    manifest: z.string().max(2_000_000),
    signature: z
      .string()
      .min(300)
      .max(2048)
      .regex(/^[A-Za-z0-9+/]+=*$/),
  })
  .strict();
export class MobileUpdateStore {
  private cache = new Map<
    string,
    { checked: number; value?: MobileUpdateIndex }
  >();
  constructor(readonly root: string) {}
  policy(platform: string, channel: string, runtime: string, fresh = false) {
    mobilePlatformSchema.parse(platform);
    mobileChannelSchema.parse(channel);
    mobileRuntimeSchema.parse(runtime);
    const key = `${channel}/${platform}`,
      now = Date.now(),
      cached = this.cache.get(key);
    if (!fresh && cached && now - cached.checked < 1000)
      return cached.value && selectMobilePolicy(cached.value, runtime);
    const file = join(this.root, "mobile", channel, platform + ".json");
    try {
      if (statSync(file).size > 512_000) throw Error("Mobile policy too large");
      const value = mobileUpdateIndexSchema.parse(
        JSON.parse(readFileSync(file, "utf8")),
      );
      if (value.platform !== platform || value.channel !== channel)
        throw Error("Mobile policy identity mismatch");
      if (cached?.value && value.policyVersion < cached.value.policyVersion)
        throw Error("Mobile policy rollback");
      this.cache.set(key, { checked: now, value });
      return selectMobilePolicy(value, runtime);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        // A partially published/bad index must not remove a previously enforced floor.
        if (!cached?.value) throw error;
      }
      this.cache.set(key, { checked: now, value: cached?.value });
      return cached?.value && selectMobilePolicy(cached.value, runtime);
    }
  }
  manifest(platform: string, channel: string, runtime: string) {
    const release = this.policy(platform, channel, runtime, true)?.ota;
    if (!release) return;
    const path = join(
      this.root,
      "mobile/manifests",
      release.updateId + ".json",
    );
    if (statSync(path).size > 2_100_000) throw Error("Manifest too large");
    const data = envelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const manifest = JSON.parse(data.manifest);
    if (
      manifest.id !== release.updateId ||
      manifest.runtimeVersion !== runtime ||
      manifest.createdAt !== release.createdAt
    )
      throw Error("Manifest does not match published release");
    return data;
  }
  assetPath(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid asset hash");
    return join(this.root, "mobile/assets", hash);
  }
}
