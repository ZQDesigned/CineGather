import type { User } from "@cinegather/contracts";
const sessions = new WeakMap<User, string>();
export function bindSession(user: User, credentialId: string) {
  sessions.set(user, credentialId);
}
export function sessionCredential(user: User) {
  return sessions.get(user);
}

const features = new WeakMap<User, Set<string>>();
export function bindFeatures(user: User, header?: string) {
  features.set(user, new Set((header ?? "").split(",").map((f) => f.trim())));
}
export function supportsEsports(user: User) {
  return features.get(user)?.has("esports-v1") ?? false;
}
