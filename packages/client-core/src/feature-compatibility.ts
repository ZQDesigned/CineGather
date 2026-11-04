import { FeatureUpdateError } from "@cinegather/api-client";
import {
  emptyFeaturePolicy,
  featurePolicySchema,
  featureIdSchema,
  featureRuleSchema,
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
    // A server may add an unrelated feature before this client knows its ID.
    // Preserve strict validation for every known rule; only unknown IDs are skipped.
    const candidate =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    if (
      candidate &&
      Array.isArray(candidate.rules) &&
      candidate.rules.length > 32
    )
      return false;
    if (
      candidate &&
      Array.isArray(candidate.rules) &&
      !candidate.rules.every(
        (rule: unknown) =>
          !!rule &&
          typeof rule === "object" &&
          "feature" in rule &&
          typeof rule.feature === "string" &&
          rule.feature.length > 0 &&
          rule.feature.length <= 128 &&
          "protocol" in rule &&
          featureRuleSchema.shape.protocol.safeParse(rule.protocol).success &&
          "reason" in rule &&
          featureRuleSchema.shape.reason.safeParse(rule.reason).success,
      )
    )
      return false;
    const compatible =
      candidate && Array.isArray(candidate.rules)
        ? {
            ...candidate,
            rules: candidate.rules.filter(
              (rule: unknown) =>
                !rule ||
                typeof rule !== "object" ||
                !("feature" in rule) ||
                typeof rule.feature !== "string" ||
                featureIdSchema.safeParse(rule.feature).success,
            ),
          }
        : raw;
    const parsed = featurePolicySchema.safeParse(compatible);
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
