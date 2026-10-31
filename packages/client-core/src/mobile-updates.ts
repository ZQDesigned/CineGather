import {
  mobileUpdatePolicySchema,
  type MobileUpdatePolicy,
  type MobileHotRelease,
} from "@cinegather/contracts";
export interface MobileUpdateIdentity {
  platform: "android" | "ios";
  channel: "stable" | "preview";
  runtime: string;
  build: number;
  revision: number;
}
export function mobileUpdateDecision(
  identity: MobileUpdateIdentity,
  policy?: MobileUpdatePolicy,
) {
  if (!policy) return { kind: "none" as const, required: false };
  if (identity.build < policy.native.minimumBuild)
    return { kind: "package" as const, required: true };
  const ota = policy.ota?.runtime === identity.runtime ? policy.ota : undefined;
  if (ota && identity.revision < ota.revision)
    return {
      kind: "hot" as const,
      required: identity.revision < ota.minimumRevision,
    };
  if (identity.build < policy.native.build)
    return { kind: "package" as const, required: false };
  return { kind: "none" as const, required: false };
}
export interface MobileUpdateSnapshot {
  status:
    | "idle"
    | "checking"
    | "downloading"
    | "ready"
    | "applying"
    | "error"
    | "unsupported";
  kind: "none" | "hot" | "package";
  required: boolean;
  policy?: MobileUpdatePolicy;
  error?: string;
  checkedAt?: number;
}
export class MobileUpdater {
  private current: MobileUpdateSnapshot;
  private listeners = new Set<() => void>();
  private checking?: Promise<void>;
  private downloading?: Promise<void>;
  private applying?: Promise<void>;
  private downloaded?: string;
  private writes = Promise.resolve();
  private forcedKey?: string;
  private serverRequirement?: "hot" | "package";
  constructor(
    private deps: {
      identity: MobileUpdateIdentity;
      enabled: boolean;
      latest(): Promise<MobileUpdatePolicy | undefined>;
      download(
        release: MobileHotRelease,
      ): Promise<{ id: string; runtime: string; revision: number }>;
      leave(): Promise<void>;
      reload(): Promise<void>;
      read(): Promise<MobileUpdatePolicy | undefined>;
      write(policy: MobileUpdatePolicy): Promise<void>;
      trace(event: Record<string, unknown>): void;
    },
  ) {
    this.current = {
      status: deps.enabled ? "idle" : "unsupported",
      kind: "none",
      required: false,
    };
  }
  snapshot = () => this.current;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private patch(value: Partial<MobileUpdateSnapshot>) {
    this.current = { ...this.current, ...value };
    for (const fn of this.listeners) fn();
  }
  require(kind: "hot" | "package") {
    if (this.deps.enabled) {
      this.serverRequirement = kind;
      this.downloaded = undefined;
      this.patch({ kind, required: true, status: "checking" });
    }
  }
  async restore() {
    if (!this.deps.enabled) return;
    try {
      const cached = await this.deps.read();
      if (cached) await this.accept(cached);
    } catch {
      this.deps.trace({ event: "mobile-update.restore-failed" });
    }
  }
  async accept(value: MobileUpdatePolicy) {
    if (!this.deps.enabled) return;
    const policy = mobileUpdatePolicySchema.parse(value),
      old = this.current.policy;
    if (
      policy.platform !== this.deps.identity.platform ||
      policy.channel !== this.deps.identity.channel
    )
      throw Error("更新不适用于当前设备");
    const decision = mobileUpdateDecision(this.deps.identity, policy);
    if (this.serverRequirement && !decision.required)
      throw Error("更新要求尚未同步，请稍后重试");
    if (decision.required) this.serverRequirement = undefined;
    if (old && policy.policyVersion <= old.policyVersion) return;
    this.patch({
      policy,
      ...decision,
      error: undefined,
      status:
        this.current.status === "applying"
          ? "applying"
          : this.downloading
            ? "downloading"
            : "idle",
    });
    const save = this.writes
      .catch(() => {})
      .then(() => this.deps.write(policy));
    this.writes = save;
    this.deps.trace({
      event: "mobile-update.policy",
      policyVersion: policy.policyVersion,
      kind: decision.kind,
      required: decision.required,
    });
    if (!decision.required) this.forcedKey = undefined;
    if (decision.required) {
      const key = `${decision.kind}:${policy.native.minimumBuild}:${policy.ota?.minimumRevision ?? 0}`;
      if (this.forcedKey !== key) {
        // Gate first, then close capture/RTC before the user can apply the update.
        await this.deps.leave();
        this.forcedKey = key;
      }
    }
    await save;
  }
  async check() {
    if (!this.deps.enabled) return;
    if (!this.checking) {
      const job = (async () => {
        if (!this.downloading && this.current.status !== "applying")
          this.patch({ status: "checking", error: undefined });
        try {
          const policy = await this.deps.latest();
          if (policy) await this.accept(policy);
          else if (this.serverRequirement) throw Error("更新要求尚未同步");
          this.patch({ checkedAt: Date.now() });
        } catch {
          this.patch({
            status: "error",
            error: "暂时无法获取更新，请检查网络后重试。",
          });
          this.deps.trace({ event: "mobile-update.check-failed" });
        }
      })();
      this.checking = job;
      void job.finally(() => {
        if (this.checking === job) this.checking = undefined;
      });
    }
    await this.checking;
    if (this.current.status === "error") return;
    if (this.current.kind === "hot") await this.download();
    else if (this.current.status !== "applying") this.patch({ status: "idle" });
  }
  private async download() {
    if (this.downloading) return this.downloading;
    const job = (async () => {
      for (;;) {
        const target = this.current.policy?.ota;
        if (!target || this.current.kind !== "hot") return;
        if (this.downloaded === target.updateId) {
          this.patch({ status: "ready" });
          return;
        }
        this.patch({ status: "downloading", error: undefined });
        try {
          const actual = await this.deps.download(target);
          if (
            actual.id !== target.updateId ||
            actual.runtime !== this.deps.identity.runtime ||
            actual.revision !== target.revision
          )
            throw Error("更新清单在下载时发生变化");
          this.deps.trace({
            event: "mobile-update.downloaded",
            updateId: actual.id,
            revision: actual.revision,
          });
          this.downloaded = actual.id;
          if (this.current.policy?.ota?.updateId !== actual.id) continue;
          this.patch({ status: "ready" });
          return;
        } catch {
          this.patch({
            status: "error",
            error: "更新下载或校验失败，请重试；当前更新要求仍然有效。",
          });
          this.deps.trace({
            event: "mobile-update.download-failed",
            updateId: target.updateId,
          });
          return;
        }
      }
    })();
    this.downloading = job;
    try {
      await job;
    } finally {
      if (this.downloading === job) this.downloading = undefined;
    }
  }
  async apply() {
    if (this.applying) return this.applying;
    if (
      this.current.kind !== "hot" ||
      this.downloaded !== this.current.policy?.ota?.updateId ||
      this.current.status !== "ready"
    )
      return;
    const job = (async () => {
      this.patch({ status: "applying", error: undefined });
      try {
        await this.writes;
        await this.deps.leave();
        await this.deps.reload();
      } catch {
        this.patch({
          status: "error",
          error: "未能安全切换版本，请重试或重新启动映聚。",
        });
        this.deps.trace({ event: "mobile-update.apply-failed" });
      }
    })();
    this.applying = job;
    try {
      await job;
    } finally {
      this.applying = undefined;
    }
  }
}
