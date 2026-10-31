import type { ShareLease, ShareState } from "@cinegather/contracts";
import { ShareCoordinator, type ShareDependencies } from "./share";
export function mobileShareCapability(platform: string, major: number) {
  const android = platform === "android";
  const audio = !android || major >= 29;
  const excludesSelf = android ? major >= 29 : major >= 27;
  return {
    audio,
    excludesSelf,
    engine: android
      ? ("projection" as const)
      : major >= 27
        ? ("screencapturekit" as const)
        : ("replaykit" as const),
    notice: !audio
      ? "当前 Android 系统不支持采集其他应用的声音，只能共享画面。升级到 Android 10 或更新系统后可共享声音。"
      : !excludesSelf
        ? "兼容模式：当前 iOS 系统不能保证排除映聚自身的声音，可能将房间声音再次共享。建议使用耳机，或关闭共享声音。受保护的应用可能禁止声音或画面采集。"
        : "声音共享包含其他允许采集的应用声音，排除映聚自身声音。受保护的应用可能禁止声音或画面采集。",
  };
}
export class MobileShare {
  private coordinator: ShareCoordinator;
  private scopeId?: string;
  captureId?: string;
  private serial = 0;
  private starting = false;
  constructor(
    private readonly deps: {
      timers?: ShareDependencies["timers"];
      scope(): string | undefined;
      allowed(): boolean;
      acquire(room: string): Promise<ShareLease>;
      renew(room: string, lease: ShareLease): Promise<ShareLease>;
      release(room: string, lease: ShareLease): Promise<void>;
      publish(room: string, lease: ShareLease, id: string): Promise<void>;
      stop(id: string): Promise<void>;
      changed(state: ShareState): void;
      error(error: unknown): void;
    },
  ) {
    this.coordinator = new ShareCoordinator({
      timers: deps.timers,
      acquire: () => deps.acquire(this.scopeId!),
      renew: (lease) => {
        if (!this.valid()) throw new Error("房间或共享权限已变更");
        return deps.renew(this.scopeId!, lease);
      },
      release: (lease) => deps.release(this.scopeId!, lease),
      select: async () => this.valid(),
      publish: async (lease) => {
        if (!this.valid()) throw new Error("房间或共享权限已变更");
        await deps.publish(this.scopeId!, lease, this.captureId!);
      },
      stop: async () => {
        if (this.captureId) await deps.stop(this.captureId);
      },
      changed: (state) => deps.changed(state),
      error: deps.error,
    });
  }
  get state() {
    return this.coordinator.state;
  }
  private valid() {
    return this.scopeId === this.deps.scope() && this.deps.allowed();
  }
  async start() {
    if (this.starting || !["idle", "failed"].includes(this.state)) return;
    if (!this.deps.scope()) throw new Error("请先进入房间");
    if (!this.deps.allowed()) throw new Error("当前账号或房间未允许屏幕共享");
    this.scopeId = this.deps.scope();
    this.captureId = `${Date.now()}-${++this.serial}`;
    this.starting = true;
    try {
      await this.coordinator.start();
    } finally {
      this.starting = false;
    }
  }
  stop() {
    return this.coordinator.stop();
  }
  async ended(id: string) {
    if (id === this.captureId) await this.stop();
  }
  revoke(leaseId: string) {
    return this.coordinator.revoke(leaseId);
  }
}
