import type {
  MobileUpdateIndex,
  MobileUpdatePolicy,
} from "@cinegather/contracts";
export function selectMobilePolicy(
  index: MobileUpdateIndex,
  runtime: string,
): MobileUpdatePolicy {
  const { runtimes, ...policy } = index;
  return { ...policy, ota: runtimes.find((r) => r.runtime === runtime) };
}
export function mobileUpdateExempt(method: string, path: string) {
  path = path.replace(/\/+$/, "");
  return (
    !path.startsWith("/api/v1/") ||
    method === "OPTIONS" ||
    path.startsWith("/api/v1/mobile-updates/") ||
    [
      "/api/v1/health",
      "/api/v1/client-policy",
      "/api/v1/client-events",
      "/api/v1/livekit/webhook",
    ].includes(path) ||
    (method === "POST" && /^\/api\/v1\/rooms\/[^/]+\/leave$/.test(path)) ||
    (method === "DELETE" &&
      (path === "/api/v1/session" ||
        /^\/api\/v1\/rooms\/[^/]+\/share-lease$/.test(path)))
  );
}
export function mobileCompatibilityFailure(
  method: string,
  path: string,
  identity: { build?: string; runtime?: string; revision?: string },
  policy: MobileUpdatePolicy,
) {
  if (mobileUpdateExempt(method, path)) return;
  const integer = (value?: string) =>
    value && /^(0|[1-9]\d{0,14})$/.test(value) ? Number(value) : 0;
  if (integer(identity.build) < policy.native.minimumBuild)
    return {
      kind: "package" as const,
      reason: "当前安装版本已不兼容，请安装新版映聚。",
    };
  if (
    policy.ota &&
    identity.runtime === policy.ota.runtime &&
    integer(identity.revision) < policy.ota.minimumRevision
  )
    return {
      kind: "hot" as const,
      reason: "当前版本的连接协议已更新，请完成热更新后继续使用。",
    };
}
