import type {
  DesktopHotStatus,
  DesktopUIIdentity,
} from "@cinegather/contracts";
import { HotStore } from "./store";
export class HotController {
  private state: DesktopHotStatus;
  private running?: Promise<void>;
  private rendererBusy = true;
  private acknowledged = false;
  private applying = false;
  private auto = true;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    readonly store: HotStore,
    private deps: {
      enabled: boolean;
      fetch: (path: string, max: number) => Promise<Uint8Array | undefined>;
      changed: (value: DesktopHotStatus) => void;
      prepare: () => Promise<boolean>;
      nativeBusy: () => boolean;
      load: (url: string) => Promise<void>;
      log: (phase: string, data?: Record<string, unknown>) => void;
    },
  ) {
    this.state = {
      enabled: deps.enabled,
      identity: store.identity,
      phase: "idle",
      required: false,
    };
  }
  snapshot() {
    return structuredClone(this.state);
  }
  private emit(patch: Partial<DesktopHotStatus> = {}) {
    this.state = { ...this.state, ...patch };
    this.deps.changed(this.snapshot());
  }
  async initialize() {
    if (!this.deps.enabled) return;
    try {
      await this.store.initialize();
      if (this.store.pending)
        try {
          await this.store.begin();
        } catch {
          await this.store.discardPending("candidate-cache-invalid");
        }
    } catch (error) {
      this.store.useFactory();
      this.error(new Error("更新存储暂不可用，已使用安装包内界面。"));
      this.deps.log("storage-startup-fallback", { message: String(error) });
    }
    this.state.identity = await this.store.identityForCurrent();
    this.updateRequirement();
  }
  private updateRequirement() {
    const p = this.store.policy;
    this.emit({
      required: !!p && this.state.identity.revision < p.minimumRevision,
      revision: p?.revision,
      notes: p?.notes,
    });
  }
  configure(auto: boolean) {
    this.auto = auto;
    if (auto && this.state.phase === "available")
      void this.download().catch(() => {});
  }
  activity(busy: boolean) {
    this.rendererBusy = busy;
  }
  get locked() {
    return this.applying;
  }
  booting() {
    this.acknowledged = false;
    clearTimeout(this.startupTimer);
    // This deadline measures startup health, not UI animation. API access is not a health prerequisite.
    this.startupTimer = setTimeout(
      () => void this.failed("renderer-ready-timeout"),
      20000,
    );
    this.startupTimer.unref();
  }
  async ready(id: string) {
    if (id !== this.store.current) throw new Error("界面启动身份不匹配");
    await this.store.ready(id);
    clearTimeout(this.startupTimer);
    this.acknowledged = true;
    this.applying = false;
    this.emit({
      phase: this.store.pending ? "ready" : "idle",
      identity: await this.store.identityForCurrent(),
      blocked: undefined,
    });
    this.updateRequirement();
    if (!this.running)
      await this.store
        .prune()
        .catch((error) =>
          this.deps.log("cache-cleanup-failed", { message: String(error) }),
        );
  }
  async failed(reason: string) {
    if (this.disposed || this.store.current === "factory") {
      this.deps.log("factory-load-failed", { reason });
      return;
    }
    clearTimeout(this.startupTimer);
    await this.store.rollback(reason);
    this.applying = false;
    this.emit({
      phase: "error",
      identity: await this.store.identityForCurrent(),
      error: "资源更新启动失败，已恢复上一版。",
      blocked: undefined,
    });
    this.updateRequirement();
    this.booting();
    await this.deps.load(this.store.url);
  }
  check() {
    if (!this.deps.enabled || this.disposed) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.performCheck().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async performCheck() {
    if (this.applying) return;
    this.emit({ phase: "checking", error: undefined });
    try {
      const raw = await this.deps.fetch(
        `policy?platform=${this.store.options.identity.platform}&arch=${this.store.options.identity.arch}&runtime=${this.store.options.identity.runtime}`,
        256 * 1024,
      );
      if (!raw) {
        this.emit({ phase: this.store.pending ? "ready" : "idle" });
        return;
      }
      await this.store.accept(raw);
      this.updateRequirement();
      if (this.store.policy!.revision <= this.state.identity.revision) {
        this.emit({ phase: "idle" });
        return;
      }
      if (this.store.pending === this.store.policy!.bundleId) {
        this.emit({ phase: "ready" });
        return;
      }
      this.emit({ phase: "available" });
      if (this.auto || this.state.required) await this.performDownload();
    } catch (e) {
      this.error(e);
    }
  }
  private error(error: unknown) {
    const message = error instanceof Error ? error.message : "资源更新未完成";
    this.deps.log("update-error", { message });
    this.emit({ phase: "error", error: message });
  }
  download() {
    if (this.running) return this.running;
    this.running = this.performDownload()
      .catch((e) => {
        this.error(e);
        throw e;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async performDownload() {
    if (!this.deps.enabled || this.applying) return;
    this.emit({ phase: "downloading", error: undefined, progress: 0 });
    await this.store.stage(
      async (path, max) => {
        const bytes = await this.deps.fetch(path, max);
        if (!bytes) throw new Error("更新资源尚未就绪");
        return bytes;
      },
      (progress) => this.emit({ progress }),
    );
    this.emit({ phase: "ready", progress: 100 });
  }
  async apply() {
    if (
      !this.deps.enabled ||
      this.applying ||
      this.running ||
      !this.acknowledged ||
      !this.store.pending
    )
      return false;
    if (this.rendererBusy || this.deps.nativeBusy()) {
      this.emit({ blocked: "当前业务结束或下次启动时更新" });
      return false;
    }
    this.applying = true;
    this.emit({ phase: "applying" });
    let switched = false;
    try {
      const safe = await this.deps.prepare();
      if (!safe || this.rendererBusy || this.deps.nativeBusy()) {
        this.applying = false;
        this.emit({
          phase: "ready",
          blocked: "请先结束当前业务并保存正在编辑的内容",
        });
        return false;
      }
      switched = await this.store.begin();
      if (!switched) {
        this.applying = false;
        this.emit({ phase: "idle" });
        return false;
      }
      this.state.identity = await this.store.identityForCurrent();
      this.booting();
      await this.deps.load(this.store.url);
      return true;
    } catch (e) {
      if (switched)
        await this.failed(e instanceof Error ? e.message : "activation-failed");
      else {
        this.applying = false;
        this.error(e);
      }
      return false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.startupTimer);
  }
  async identity(): Promise<DesktopUIIdentity> {
    return this.store.identityForCurrent();
  }
}
export async function boundedFetch(url: string, max: number) {
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 204) return;
  if (!response.ok) throw new Error(`更新服务返回 ${response.status}`);
  if (Number(response.headers.get("content-length")) > max)
    throw new Error("更新资源过大");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("更新响应为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new Error("更新资源过大");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
