import { PARTY_SUBMISSIONS_FEATURE, type User } from "@cinegather/contracts";
/** Keep new permission enums out of old clients' strict account parsers.
 * This projects response data only; authorization always uses the full access state. */
export function presentAccountUser(user: User, features?: string): User {
  if (features?.split(",").some((f) => f.trim() === PARTY_SUBMISSIONS_FEATURE))
    return user;
  return {
    ...user,
    ...(user.permissions
      ? {
          permissions: user.permissions.filter(
            (p) => !p.startsWith("party-submissions."),
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
