import type { User } from "@cinegather/contracts";
const sessions = new WeakMap<User, string>();
export function bindSession(user: User, credentialId: string) {
  sessions.set(user, credentialId);
}
export function sessionCredential(user: User) {
  return sessions.get(user);
}
