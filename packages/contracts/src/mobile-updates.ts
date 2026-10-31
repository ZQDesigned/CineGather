import { z } from "zod";
import { clientVersionSchema } from "./client-policy";
export const mobilePlatformSchema = z.enum(["android", "ios"]);
export const mobileChannelSchema = z.enum(["stable", "preview"]);
export const mobileRuntimeSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const httpsUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "安装入口必须使用 HTTPS");
export const mobileNativeReleaseSchema = z
  .object({
    version: clientVersionSchema,
    build: revision.min(1),
    minimumBuild: revision,
    url: httpsUrl.optional(),
    notes: z.string().max(4000),
  })
  .strict()
  .refine((v) => v.minimumBuild <= v.build, "最低构建不能高于最新构建");
export const mobileHotReleaseSchema = z
  .object({
    runtime: mobileRuntimeSchema,
    revision: revision.min(1),
    minimumRevision: revision,
    version: clientVersionSchema,
    updateId: z.uuid(),
    createdAt: z.iso.datetime(),
    notes: z.string().max(4000),
  })
  .strict()
  .refine(
    (v) => v.minimumRevision <= v.revision,
    "最低热更新不能高于最新热更新",
  );
export const mobileUpdatePolicySchema = z
  .object({
    format: z.literal(1),
    platform: mobilePlatformSchema,
    channel: mobileChannelSchema,
    policyVersion: revision.min(1),
    native: mobileNativeReleaseSchema,
    ota: mobileHotReleaseSchema.optional(),
  })
  .strict();
export const mobileUpdateIndexSchema = mobileUpdatePolicySchema
  .omit({ ota: true })
  .extend({
    runtimes: z.array(mobileHotReleaseSchema).max(64),
  })
  .strict()
  .refine(
    (v) => new Set(v.runtimes.map((r) => r.runtime)).size === v.runtimes.length,
    "原生运行时重复",
  );
export type MobileUpdatePolicy = z.infer<typeof mobileUpdatePolicySchema>;
export type MobileUpdateIndex = z.infer<typeof mobileUpdateIndexSchema>;
export type MobileHotRelease = z.infer<typeof mobileHotReleaseSchema>;
