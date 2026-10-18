import type { ShareLease, ShareState } from "@cinegather/contracts";
export interface ShareDependencies {
  acquire(): Promise<ShareLease>;
  renew(lease: ShareLease): Promise<ShareLease>;
  release(lease: ShareLease): Promise<void>;
  select(): Promise<boolean>;
  publish(): Promise<void>;
  stop(): Promise<void>;
  changed(state: ShareState, revision: number): void;
  error(error: unknown): void;
}
export class ShareCoordinator {
  state: ShareState = "idle";
  private revision = 0;
  private lease?: ShareLease;
  private timer?: ReturnType<typeof setInterval>;
  private starting = false;
  private renewing = false;
  constructor(private readonly deps: ShareDependencies) {}
  private change(state: ShareState) {
    this.state = state;
    this.deps.changed(state, this.revision);
  }
  async start() {
    if (this.starting || !["idle", "failed"].includes(this.state)) return;
    this.starting = true;
    const revision = ++this.revision;
    this.change("acquiringLease");
    try {
      const lease = await this.deps.acquire();
      if (revision !== this.revision) {
        await this.deps.release(lease);
        return;
      }
      this.lease = lease;
      this.timer = setInterval(() => void this.renew(revision), 10_000);
      this.change("selectingSource");
      const selected = await this.deps.select();
      if (revision !== this.revision) return;
      if (!selected) {
        await this.stop();
        return;
      }
      this.change("publishing");
      await this.deps.publish();
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
  private async renew(revision: number) {
    if (this.renewing || !this.lease || revision !== this.revision) return;
    this.renewing = true;
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
      this.renewing = false;
    }
  }
  async stop() {
    ++this.revision;
    clearInterval(this.timer);
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
