import {
  featurePolicySchema,
  clientPlatformSchema,
  versionBelow,
  type FeaturePolicy,
  type ClientPlatform,
} from "@cinegather/contracts";
export type CompatibilityScope = "ordinary" | "feature" | "global";
export function validatePublicationScope(
  scope: string | undefined,
  changesGlobalFloor: boolean,
) {
  if (scope && !["ordinary", "feature", "global"].includes(scope))
    throw Error("Compatibility scope must be ordinary, feature or global");
  if (changesGlobalFloor && scope !== "global")
    throw Error(
      "Changing a global minimum requires --compatibility-scope global; publish feature requirements separately",
    );
}
export interface FeatureTarget {
  version?: string;
  build?: number;
  runtimes?: { runtime: string; revision: number }[];
}
export function validateFeatureTargets(
  input: FeaturePolicy,
  targets: Partial<Record<ClientPlatform, FeatureTarget>>,
) {
  const policy = featurePolicySchema.parse(input);
  for (const rule of policy.rules)
    for (const platform of rule.platforms ?? clientPlatformSchema.options) {
      const version = rule.minimumVersions?.[platform],
        mobile =
          platform === "ios" || platform === "android"
            ? rule.mobile?.[platform]
            : undefined;
      const needsTarget = rule.protocol > 1 || !!version || !!mobile;
      if (!needsTarget) continue;
      const target = targets[platform];
      if (!target)
        throw Error(`Missing ${platform} release for ${rule.feature}`);
      if (platform === "ios" || platform === "android") {
        if (
          !mobile?.minimumBuild &&
          !Object.keys(mobile?.minimumRevisions ?? {}).length
        )
          throw Error(
            `Declare native build or runtime revision for ${rule.feature}/${platform}`,
          );
        if (mobile?.minimumBuild && (target.build ?? 0) < mobile.minimumBuild)
          throw Error("Required mobile package is not available");
        for (const [runtime, revision] of Object.entries(
          mobile?.minimumRevisions ?? {},
        ))
          if (
            !target.runtimes?.some(
              (r) => r.runtime === runtime && r.revision >= revision,
            )
          )
            throw Error(
              "Required runtime-specific hot update is not available",
            );
      } else if (!version)
        throw Error(`Declare minimum version for ${rule.feature}/${platform}`);
      if (version && (!target.version || versionBelow(target.version, version)))
        throw Error("Required feature release is not available");
    }
  return policy;
}
