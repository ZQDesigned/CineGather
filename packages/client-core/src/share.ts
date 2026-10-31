import type { ShareLease, ShareState } from "@cinegather/contracts";
export interface ShareDependencies {
  acquire(preempt?: boolean): Promise<ShareLease>;
  renew(lease: ShareLease): Promise<ShareLease>;
  release(lease: ShareLease): Promise<void>;
  select(): Promise<boolean>;
  publish(lease: ShareLease): Promise<void>;
  replace?(lease: ShareLease): Promise<void>;
  stop(): Promise<void>;
  changed(state: ShareState, revision: number): void;
  error(error: unknown): void;
  timers?: {
    setInterval(
      handler: () => void,
      delay: number,
    ): ReturnType<typeof setInterval>;
    clearInterval(id: ReturnType<typeof setInterval>): void;
  };
}
export class ShareCoordinator {
  state: ShareState = "idle";
  private revision = 0;
  private lease?: ShareLease;
  private timer?: ReturnType<typeof setInterval>;
  private starting = false;
  private switching = false;
  private revokedLeases = new Set<string>();
  private renewing?: number;
  private stopping?: Promise<void>;
  constructor(private readonly deps: ShareDependencies) {}
  private change(state: ShareState) {
    this.state = state;
    this.deps.changed(state, this.revision);
  }
  async start(preempt = false) {
    return this.begin(() => this.deps.acquire(preempt));
  }
  async startHandoff(acquire: () => Promise<ShareLease>) {
    return this.begin(acquire, true);
  }
  private async begin(acquire: () => Promise<ShareLease>, sourceFirst = false) {
    if (
      this.starting ||
      this.switching ||
      !["idle", "failed"].includes(this.state)
    )
      return;
    this.starting = true;
    const revision = ++this.revision;
    this.change("acquiringLease");
    try {
      if (sourceFirst) {
        this.change("selectingSource");
        const selected = await this.deps.select();
        if (revision !== this.revision) return;
        if (!selected) {
          await this.stop();
          return;
        }
        this.change("acquiringLease");
      }
      const lease = await acquire();
      if (revision !== this.revision) {
        await this.deps.release(lease);
        return;
      }
      this.lease = lease;
      if (this.revokedLeases.has(lease.leaseId)) {
        await this.stop();
        return;
      }
      this.timer = (this.deps.timers?.setInterval ?? setInterval)(
        () => void this.renew(revision),
        10_000,
      );
      if (!sourceFirst) {
        this.change("selectingSource");
        const selected = await this.deps.select();
        if (revision !== this.revision) return;
        if (!selected) {
          await this.stop();
          return;
        }
      }
      this.change("publishing");
      await this.deps.publish(this.lease!);
      if (revision !== this.revision) {
        await this.deps.stop();
        return;
      }
      this.change("active");
    } catch (error) {
      if (revision === this.revision) {
        await this.stop();
        this.change("failed");
        this.deps.error(error);
      }
    } finally {
      this.starting = false;
    }
  }
  async switchSource() {
    if (
      this.switching ||
      this.starting ||
      this.state !== "active" ||
      !this.lease ||
      !this.deps.replace
    )
      return;
    this.switching = true;
    const revision = this.revision;
    try {
      if (
        !(await this.deps.select()) ||
        revision !== this.revision ||
        this.state !== "active"
      )
        return;
      await this.deps.replace(this.lease!);
    } catch (error) {
      // Selection/replacement errors leave the existing share and lease intact.
      if (revision === this.revision) this.deps.error(error);
    } finally {
      this.switching = false;
    }
  }
  private async renew(revision: number) {
    if (this.renewing === revision || !this.lease || revision !== this.revision)
      return;
    this.renewing = revision;
    try {
      const next = await this.deps.renew(this.lease);
      if (revision === this.revision) this.lease = next;
    } catch (error) {
      if (revision === this.revision) {
        await this.stop();
        this.change("failed");
        this.deps.error(error);
      }
    } finally {
      if (this.renewing === revision) this.renewing = undefined;
    }
  }
  async revoke(leaseId: string) {
    this.revokedLeases.add(leaseId);
    if (this.revokedLeases.size > 32)
      this.revokedLeases.delete(this.revokedLeases.values().next().value!);
    if (this.lease?.leaseId !== leaseId) return false;
    await this.stop();
    return true;
  }
  async stop() {
    if (this.stopping) return this.stopping;
    const stopping = this.stopInternal();
    this.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.stopping === stopping) this.stopping = undefined;
    }
  }
  private async stopInternal() {
    ++this.revision;
    if (this.timer !== undefined)
      (this.deps.timers?.clearInterval ?? clearInterval)(this.timer);
    this.timer = undefined;
    const lease = this.lease;
    this.lease = undefined;
    this.change("stopping");
    try {
      await this.deps.stop();
    } finally {
      if (lease) {
        try {
          await this.deps.release(lease);
        } catch (error) {
          this.deps.error(error);
        }
      }
      this.change("idle");
    }
  }
}
