import { FeatureUpdateError } from "@cinegather/api-client";
import {
  emptyFeaturePolicy,
  featurePolicySchema,
  featureCompatibilityFailure,
  type FeatureClientIdentity,
  type FeatureId,
  type FeaturePolicy,
} from "@cinegather/contracts";
// Learning a policy is silent; callers decide which active operation to stop.
export class FeatureCompatibility {
  private policy: FeaturePolicy = emptyFeaturePolicy;
  private accepted = false;
  private legacy = false;
  get hasPolicy() {
    return this.accepted;
  }
  get legacyServer() {
    return this.legacy;
  }
  private pending?: Promise<boolean>;
  constructor(
    private readonly identity: () => FeatureClientIdentity,
    private readonly changed: () => void = () => {},
  ) {}
  accept(raw: unknown) {
    const parsed = featurePolicySchema.safeParse(raw);
    if (!parsed.success) return false;
    const next = parsed.data;
    if (
      this.accepted &&
      (next.revision < this.policy.revision ||
        (next.revision === this.policy.revision &&
          JSON.stringify(next) !== JSON.stringify(this.policy)))
    )
      return false;
    const changed = JSON.stringify(next) !== JSON.stringify(this.policy);
    this.policy = next;
    this.accepted = true;
    this.legacy = false;
    if (changed) this.changed();
    return true;
  }
  issue(feature: FeatureId, resourceProtocol = 1) {
    return featureCompatibilityFailure(
      feature,
      this.identity(),
      this.policy,
      resourceProtocol,
    );
  }
  require(feature: FeatureId, resourceProtocol = 1) {
    const issue = this.issue(feature, resourceProtocol);
    if (issue) throw new FeatureUpdateError(issue);
  }
  refresh(
    origin: string,
    request: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const res = await request(
          `${origin.replace(/\/$/, "")}/api/v1/feature-policy`,
          {
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!res.ok) {
          if (!this.accepted && [404, 501].includes(res.status))
            this.legacy = true;
          return false;
        }
        const raw = await res.text();
        return raw.length <= 65536 && this.accept(JSON.parse(raw));
      } catch {
        return false;
      }
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
}
