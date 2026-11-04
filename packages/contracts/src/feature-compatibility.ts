import { z } from "zod";
import {
  clientPlatformSchema,
  clientVersionSchema,
  versionBelow,
  type ClientPlatform,
} from "./client-policy";
export const featureLabels = {
  "room.standard": "普通房间",
  "room.large": "多人普通房间",
  "room.esports": "电竞赛事房",
  "screen.publish": "屏幕共享",
  "screen.watch": "观看共享",
  "screen.quality.game": "1080p60 共享",
} as const;
export const featureIdSchema = z.enum([
  "room.standard",
  "room.large",
  "room.esports",
  "screen.publish",
  "screen.watch",
  "screen.quality.game",
]);
export type FeatureId = z.infer<typeof featureIdSchema>;
const protocol = z.number().int().min(1).max(64),
  counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const featureProtocolsSchema = z.partialRecord(
  featureIdSchema,
  z
    .array(protocol)
    .min(1)
    .max(16)
    .refine((v) => new Set(v).size === v.length),
);
export type FeatureProtocols = z.infer<typeof featureProtocolsSchema>;
export const currentFeatureProtocols: FeatureProtocols = {
  "room.standard": [1],
  "room.large": [1],
  "room.esports": [1, 2],
  "screen.publish": [1],
  "screen.watch": [1],
  "screen.quality.game": [1],
};
export const protocolHeaders = {
  "X-CineGather-Features": "esports-v1,esports-v2",
  "X-CineGather-Protocols": JSON.stringify(currentFeatureProtocols),
};
export function parseFeatureProtocols(
  raw?: string,
  legacy?: string,
): FeatureProtocols {
  if (raw !== undefined) {
    if (raw.length > 4096) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
      return featureProtocolsSchema.parse(
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => featureIdSchema.safeParse(key).success,
          ),
        ),
      );
    } catch {
      return {};
    }
  }
  const flags = new Set((legacy ?? "").split(",").map((x) => x.trim()));
  return {
    "room.standard": [1],
    "room.large": [1],
    "screen.publish": [1],
    "screen.watch": [1],
    "screen.quality.game": [1],
    "room.esports": flags.has("esports-v2")
      ? [1, 2]
      : flags.has("esports-v1")
        ? [1]
        : undefined,
  };
}
const mobileRequirement = z
  .object({
    minimumBuild: counter.optional(),
    minimumRevisions: z
      .record(z.string().regex(/^[A-Za-z0-9._-]{1,128}$/), counter)
      .refine((v) => Object.keys(v).length <= 64)
      .optional(),
  })
  .strict();
export const featureRuleSchema = z
  .object({
    feature: featureIdSchema,
    platforms: z
      .array(clientPlatformSchema)
      .min(1)
      .max(5)
      .refine((v) => new Set(v).size === v.length)
      .optional(),
    protocol,
    appliesFromProtocol: protocol.optional(),
    reason: z.string().min(1).max(500),
    minimumVersions: z
      .partialRecord(clientPlatformSchema, clientVersionSchema)
      .optional(),
    mobile: z
      .object({
        android: mobileRequirement.optional(),
        ios: mobileRequirement.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const featurePolicySchema = z
  .object({
    format: z.literal(1),
    revision: counter.min(1),
    rules: z.array(featureRuleSchema).max(32),
  })
  .strict()
  .refine(
    (p) => new Set(p.rules.map((r) => r.feature)).size === p.rules.length,
    "功能规则重复",
  );
export type FeaturePolicy = z.infer<typeof featurePolicySchema>;
export const emptyFeaturePolicy: FeaturePolicy = {
  format: 1,
  revision: 1,
  rules: [],
};
export const featureUpdateIssueSchema = z.object({
  scope: z.literal("feature"),
  feature: featureIdSchema,
  protocol,
  roomId: z.uuid().optional(),
  reason: z.string().min(1).max(500),
  updateKind: z.enum(["desktop", "reload", "hot", "package"]),
  minimumVersion: clientVersionSchema.optional(),
  minimumBuild: counter.optional(),
  minimumRevision: counter.optional(),
});
export type FeatureUpdateIssue = z.infer<typeof featureUpdateIssueSchema>;
export interface FeatureClientIdentity {
  scopedUpdates?: boolean;
  platform?: ClientPlatform;
  version?: string;
  protocols: FeatureProtocols;
  build?: number;
  runtime?: string;
  revision?: number;
}
export function featureCompatibilityFailure(
  feature: FeatureId,
  identity: FeatureClientIdentity,
  policy: FeaturePolicy = emptyFeaturePolicy,
  resourceProtocol = 1,
): FeatureUpdateIssue | undefined {
  const platform = identity.platform;
  const rule = policy.rules.find(
      (r) =>
        r.feature === feature &&
        resourceProtocol >= (r.appliesFromProtocol ?? 1) &&
        (!r.platforms || !platform || r.platforms.includes(platform)),
    ),
    required = Math.max(resourceProtocol, rule?.protocol ?? 1);
  const minimumVersion = platform
    ? rule?.minimumVersions?.[platform]
    : undefined;
  const mobile =
    platform === "android" || platform === "ios"
      ? rule?.mobile?.[platform]
      : undefined;
  const minimumRevision = identity.runtime
    ? mobile?.minimumRevisions?.[identity.runtime]
    : undefined;
  const buildOld =
    mobile?.minimumBuild !== undefined &&
    (identity.build ?? 0) < mobile.minimumBuild;
  const revisionOld =
    minimumRevision !== undefined && (identity.revision ?? 0) < minimumRevision;
  const needsKnownPlatform =
    !platform &&
    !!rule &&
    (!!rule.platforms || !!rule.minimumVersions || !!rule.mobile);
  if (
    !needsKnownPlatform &&
    identity.protocols[feature]?.includes(required) &&
    (!minimumVersion ||
      !versionBelow(identity.version ?? "", minimumVersion)) &&
    !buildOld &&
    !revisionOld
  )
    return;
  return {
    scope: "feature",
    feature,
    protocol: required,
    reason: rule?.reason ?? `${featureLabels[feature]}需要更新后使用。`,
    updateKind:
      platform === "web"
        ? "reload"
        : platform === "android" || platform === "ios"
          ? !buildOld && revisionOld
            ? "hot"
            : "package"
          : "desktop",
    minimumVersion,
    minimumBuild: mobile?.minimumBuild,
    minimumRevision,
  };
}

export const featureClientIdentitySchema = z.object({
  scopedUpdates: z.boolean().optional(),
  platform: clientPlatformSchema.optional(),
  version: clientVersionSchema.optional(),
  protocols: featureProtocolsSchema,
  build: counter.optional(),
  runtime: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .optional(),
  revision: counter.optional(),
});
