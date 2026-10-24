import type { UpdateStatus } from "@cinegather/contracts";
import { newerVersion, type Release } from "./update-release";
export interface UpdateTransport {
  latest(): Promise<Release | null>;
  download(release: Release, progress: (value: number) => void): Promise<void>;
  cancel(): void;
  install(): Promise<void>;
}
export class UpdateController {
  private state: UpdateStatus;
  private release?: Release;
  private revision = 0;
  private downloadPending = false;
  constructor(
    mode: UpdateStatus["mode"],
    currentVersion: string,
    private transport: UpdateTransport,
    private changed: (status: UpdateStatus) => void,
  ) {
    this.state = {
      mode,
      currentVersion,
      status: mode === "disabled" ? "disabled" : "idle",
      inRoom: false,
    };
  }
  snapshot() {
    return { ...this.state };
  }
  private patch(patch: Partial<UpdateStatus>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.snapshot());
  }
  setInRoom(active: boolean) {
    if (active && this.state.status === "installing")
      throw new Error("正在安装更新，请稍后进入房间");
    this.patch({ inRoom: active });
    if (active && this.state.status === "downloading") {
      ++this.revision;
      this.transport.cancel();
      this.patch({ status: "available", progress: undefined });
    }
  }
  async check() {
    if (
      this.state.mode === "disabled" ||
      this.downloadPending ||
      ["checking", "downloading", "downloaded", "installing"].includes(
        this.state.status,
      )
    )
      return this.snapshot();
    this.patch({ status: "checking", error: undefined });
    try {
      const release = await this.transport.latest();
      this.release =
        release && newerVersion(release.version, this.state.currentVersion)
          ? release
          : undefined;
      this.patch({
        status: this.release ? "available" : "current",
        latestVersion: this.release?.version,
        notes: this.release?.notes,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      this.release = undefined;
      this.patch({
        status: "error",
        latestVersion: undefined,
        notes: undefined,
        error: "检查更新失败，请稍后重试。如持续失败，请从官网下载新版。",
      });
    }
    return this.snapshot();
  }
  async download() {
    if (
      this.state.mode !== "install" ||
      !this.release ||
      this.state.inRoom ||
      this.downloadPending ||
      !["available", "error"].includes(this.state.status)
    )
      throw new Error("请先离开房间并检查可用更新");
    this.downloadPending = true;
    const revision = ++this.revision;
    this.patch({ status: "downloading", error: undefined, progress: 0 });
    try {
      await this.transport.download(this.release, (progress) => {
        if (revision === this.revision)
          this.patch({ progress: Math.max(0, Math.min(100, progress)) });
      });
      if (revision === this.revision)
        this.patch({ status: "downloaded", progress: 100 });
    } catch {
      if (revision === this.revision)
        this.patch({ status: "error", error: "下载或验证更新失败，请重试。" });
    } finally {
      this.downloadPending = false;
    }
  }
  async install() {
    if (
      this.state.mode !== "install" ||
      this.state.status !== "downloaded" ||
      this.state.inRoom
    )
      throw new Error("请先离开房间并完成更新下载");
    this.patch({ status: "installing", error: undefined });
    try {
      await this.transport.install();
    } catch {
      this.patch({
        status: "error",
        error: "无法安装更新，请重新下载或从官网下载。",
      });
    }
  }
  downloadURL() {
    return this.release;
  }
  installFailed() {
    this.patch({
      status: "error",
      error: "无法安装更新，请重新下载或从官网下载。",
    });
  }
}
