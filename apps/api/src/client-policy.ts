import {
  clientPolicySchema,
  versionBelow,
  type ClientPolicy,
} from "@cinegather/contracts";
export function readClientPolicy(
  env: Record<string, string | undefined>,
): ClientPolicy {
  return clientPolicySchema.parse({
    minimumVersions: {
      win32: env.CLIENT_MIN_VERSION_WINDOWS ?? "0.0.0",
      darwin: env.CLIENT_MIN_VERSION_MACOS ?? "0.0.0",
      web: env.CLIENT_MIN_VERSION_WEB ?? "0.0.0",
    },
    reason:
      env.CLIENT_UPDATE_REASON ?? "当前版本已不受支持，请更新映聚后继续使用。",
  });
}
export function compatibilityFailure(
  method: string,
  path: string,
  platform: string | undefined,
  version: string | undefined,
  policy: ClientPolicy,
) {
  path = path.replace(/\/+$/, "");
  if (
    !path.startsWith("/api/v1/") ||
    method === "OPTIONS" ||
    [
      "/api/v1/health",
      "/api/v1/client-policy",
      "/api/v1/client-events",
      "/api/v1/livekit/webhook",
    ].includes(path) ||
    (method === "DELETE" &&
      (path === "/api/v1/session" ||
        /^\/api\/v1\/rooms\/[^/]+\/share-lease$/.test(path))) ||
    (method === "POST" && /^\/api\/v1\/rooms\/[^/]+\/leave$/.test(path))
  )
    return;
  const minimumVersion =
    platform && Object.hasOwn(policy.minimumVersions, platform)
      ? policy.minimumVersions[
          platform as keyof ClientPolicy["minimumVersions"]
        ]
      : Object.values(policy.minimumVersions).reduce(
          (highest, next) => (versionBelow(highest, next) ? next : highest),
          "0.0.0",
        );
  if (minimumVersion !== "0.0.0" && versionBelow(version ?? "", minimumVersion))
    return { minimumVersion, reason: policy.reason };
}
