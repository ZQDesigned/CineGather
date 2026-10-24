import type { UpdateStatus } from "@cinegather/contracts";
import { clientVersionSchema, versionBelow } from "@cinegather/contracts";
import { newerVersion, type Release } from "./update-release";
export interface UpdateTransport {
  latest(): Promise<Release | null>;
  download(release: Release, progress: (value: number) => void): Promise<void>;
  cancel(): void;
  install(allowed?: () => boolean): Promise<void>;
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
    if (active && (this.state.status === "installing" || this.state.required))
      throw new Error("请先完成客户端更新再进入房间");
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
      if (release?.minimumVersion)
        this.requireUpdate(
          release.minimumVersion,
          release.reason ?? "当前版本已不受支持，请更新后继续使用。",
        );
      this.release =
        release &&
        newerVersion(release.version, this.state.currentVersion) &&
        (!this.state.minimumVersion ||
          !versionBelow(release.version, this.state.minimumVersion))
          ? release
          : undefined;
      this.patch({
        status: this.release
          ? "available"
          : this.state.required
            ? "error"
            : "current",
        error:
          !this.release && this.state.required
            ? "兼容的新版暂不可用，请稍后重新检查。"
            : undefined,
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
      (this.state.minimumVersion &&
        this.release &&
        versionBelow(this.release.version, this.state.minimumVersion)) ||
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
      this.state.inRoom ||
      (this.state.minimumVersion &&
        (!this.release ||
          versionBelow(this.release.version, this.state.minimumVersion)))
    )
      throw new Error("请先离开房间并完成更新下载");
    this.patch({ status: "installing", error: undefined });
    const release = this.release;
    try {
      await this.transport.install(
        () =>
          this.state.status === "installing" &&
          this.release === release &&
          !this.state.inRoom &&
          Boolean(release) &&
          (!this.state.minimumVersion ||
            !versionBelow(release!.version, this.state.minimumVersion)),
      );
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
  requireUpdate(minimumVersion: string, reason: string) {
    clientVersionSchema.parse(minimumVersion);
    if (!versionBelow(this.state.currentVersion, minimumVersion)) return;
    if (
      this.state.minimumVersion &&
      versionBelow(minimumVersion, this.state.minimumVersion)
    )
      return;
    if (
      this.state.required &&
      this.state.minimumVersion === minimumVersion &&
      this.state.reason === reason
    )
      return;
    this.patch({
      required: true,
      minimumVersion,
      reason: reason.slice(0, 500),
    });
    if (this.release && versionBelow(this.release.version, minimumVersion)) {
      ++this.revision;
      this.transport.cancel();
      this.release = undefined;
      this.patch({
        status: "idle",
        latestVersion: undefined,
        notes: undefined,
        progress: undefined,
      });
    }
  }
  installFailed() {
    this.patch({
      status: "error",
      error: "无法安装更新，请重新下载或从官网下载。",
    });
  }
}
