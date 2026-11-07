import { readFile } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { HttpException } from "@nestjs/common";
import {
  featurePolicySchema,
  emptyFeaturePolicy,
  currentFeatureProtocols,
  featureCompatibilityFailure,
  type FeaturePolicy,
  type FeatureClientIdentity,
  type FeatureId,
  type User,
} from "@cinegather/contracts";
export class FeaturePolicyStore {
  private value: FeaturePolicy;
  private loaded = false;
  private revision = 0;
  private listener?: () => void;
  private watchers = new Set<() => void>();
  constructor(
    private readonly file?: string,
    initial: FeaturePolicy = emptyFeaturePolicy,
  ) {
    this.value = featurePolicySchema.parse(initial);
  }
  snapshot() {
    return this.value;
  }
  subscribe(listener: () => void) {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
    };
  }
  async refresh() {
    if (!this.file) return true;
    const generation = ++this.revision;
    try {
      const raw = await readFile(this.file, "utf8");
      if (raw.length > 65536) throw Error("oversize");
      const next = featurePolicySchema.parse(JSON.parse(raw));
      if (generation !== this.revision) return false;
      if (this.loaded && next.revision < this.value.revision) return false;
      const changed = JSON.stringify(next) !== JSON.stringify(this.value);
      if (this.loaded && next.revision === this.value.revision && changed)
        return false;
      this.loaded = true;
      this.value = next;
      if (changed) for (const callback of this.watchers) callback();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !this.loaded)
        return true;
      return false;
    }
  }
  async start() {
    if (!(await this.refresh()))
      throw Error("Invalid feature compatibility policy");
    if (this.file) {
      this.listener = () => {
        void this.refresh().then((ok) => {
          if (!ok)
            console.error(JSON.stringify({ event: "feature-policy.invalid" }));
        });
      };
      watchFile(
        this.file,
        { interval: 1000, persistent: false },
        this.listener,
      );
    }
  }
  close() {
    if (this.file && this.listener) unwatchFile(this.file, this.listener);
    this.watchers.clear();
    ++this.revision;
  }
}
const clients = new WeakMap<
  User,
  { identity: FeatureClientIdentity; policy: () => FeaturePolicy }
>();
export function bindFeatureClient(
  user: User,
  identity: FeatureClientIdentity,
  policy: () => FeaturePolicy,
) {
  clients.set(user, { identity, policy });
}
export function boundFeatureClient(user: User) {
  return clients.get(user)?.identity;
}
export function featureClient(user: User): FeatureClientIdentity {
  return clients.get(user)?.identity ?? { protocols: currentFeatureProtocols };
}
export function requireFeatureIdentity(
  feature: FeatureId,
  identity: FeatureClientIdentity,
  policy: FeaturePolicy,
  resourceProtocol = 1,
) {
  const issue = featureCompatibilityFailure(
    feature,
    identity,
    policy,
    resourceProtocol,
  );
  if (issue)
    throw new HttpException(
      {
        code: "FEATURE_UPDATE_REQUIRED",
        message: issue.reason,
        compatibility: issue,
      },
      identity.scopedUpdates === false ? 409 : 426,
    );
}
export function requireFeature(
  user: User,
  feature: FeatureId,
  resourceProtocol = 1,
) {
  const context = clients.get(user);
  if (context)
    requireFeatureIdentity(
      feature,
      context.identity,
      context.policy(),
      resourceProtocol,
    );
}
export function requireRoomFeature(
  user: User,
  room: {
    id?: string;
    mode?: string;
    maxMembers: number;
    esportsAdvanced?: boolean;
  },
) {
  try {
    if (room.mode === "esports")
      requireFeature(user, "room.esports", room.esportsAdvanced ? 2 : 1);
    else {
      requireFeature(user, "room.standard");
      if (room.maxMembers > 10) requireFeature(user, "room.large");
    }
  } catch (error) {
    if (room.id && error instanceof HttpException) {
      const body = error.getResponse() as { compatibility?: object };
      if (body.compatibility)
        throw new HttpException(
          {
            ...body,
            compatibility: { ...body.compatibility, roomId: room.id },
          },
          error.getStatus(),
        );
    }
    throw error;
  }
}
