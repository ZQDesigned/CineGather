import {
  PARTY_SUBMISSIONS_FEATURE,
  POINTS_FEATURE,
  type User,
} from "@cinegather/contracts";
/** Keep new permission enums out of old clients' strict account parsers.
 * This projects response data only; authorization always uses the full access state. */
export function presentAccountUser(user: User, features?: string): User {
  const supported = new Set(features?.split(",").map((f) => f.trim()) ?? []);
  return {
    ...user,
    ...(user.permissions
      ? {
          permissions: user.permissions.filter(
            (p) =>
              (!p.startsWith("party-submissions.") ||
                supported.has(PARTY_SUBMISSIONS_FEATURE)) &&
              (!p.startsWith("points.") || supported.has(POINTS_FEATURE)),
          ),
        }
      : {}),
  };
}
export function presentAccountSession<T extends { user: User }>(
  session: T,
  features?: string,
): T {
  return { ...session, user: presentAccountUser(session.user, features) };
}
