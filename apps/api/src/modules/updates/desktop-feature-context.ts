import type { DesktopPolicy, User, FeatureId } from "@cinegather/contracts";
import { fail } from "../../core/errors";
const clients = new WeakMap<
  User,
  { revision: number; policy: () => DesktopPolicy | undefined }
>();
export function bindDesktopCompatibility(
  user: User,
  revision: unknown,
  policy: () => DesktopPolicy | undefined,
) {
  clients.set(user, {
    revision:
      typeof revision === "string" && /^\d{1,10}$/.test(revision)
        ? Number(revision)
        : -1,
    policy,
  });
}
/** Only call at acquisition/start, never at lease renewal or an existing activity operation. */
export function requireDesktopFeature(user: User, feature: FeatureId) {
  const client = clients.get(user);
  if (!client) return;
  const policy = client.policy();
  if (policy && (policy.featureMinimums[feature] ?? 0) > client.revision)
    fail(
      426,
      "DESKTOP_UI_UPDATE_REQUIRED",
      "此功能需要更新资源，请在当前业务结束后应用更新。",
    );
}
