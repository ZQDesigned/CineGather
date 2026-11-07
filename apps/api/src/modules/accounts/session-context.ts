import { boundFeatureClient } from "../updates/feature-policy";
import { rooms } from "@cinegather/database";
import { eq, or } from "drizzle-orm";
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
  const bound = boundFeatureClient(user);
  return bound
    ? !!bound.protocols["room.esports"]?.includes(1)
    : (features.get(user)?.has("esports-v1") ?? false);
}

export function supportsDynamicEsports(user: User) {
  const bound = boundFeatureClient(user);
  return bound
    ? !!bound.protocols["room.esports"]?.includes(2)
    : (features.get(user)?.has("esports-v2") ?? false);
}
export function esportsVisibility(user: User) {
  return supportsDynamicEsports(user)
    ? undefined
    : supportsEsports(user)
      ? or(eq(rooms.mode, "standard"), eq(rooms.esportsAdvanced, false))
      : eq(rooms.mode, "standard");
}
