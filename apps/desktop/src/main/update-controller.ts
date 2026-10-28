import { shouldAdvanceUpdateRequirement } from "../shared/update-requirement";
import type { UpdateStatus } from "@cinegather/contracts";
import { clientVersionSchema, versionBelow } from "@cinegather/contracts";
import { newerVersion, type Release } from "./update-release";
export interface UpdateTransport {
  latest(): Promise<Release | null>;
  minimum?(): Promise<{ version: string; reason: string } | undefined>;
  download(release: Release, progress: (value: number) => void): Promise<void>;
  cancel(): void;
  discard?(): void;
  install(allowed?: () => boolean): Promise<void>;
}
export class UpdateController {
  private state: UpdateStatus;
  private release?: Release;
  private revision = 0;
  private checkRevision = 0;
  private checking = false;
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
  }
  acceptRelease(release: Release | null) {
    if (this.state.mode === "disabled") return this.snapshot();
    ++this.checkRevision;
    if (release?.minimumVersion)
      this.requireUpdate(
        release.minimumVersion,
        release.reason ?? "当前版本已不受支持，请更新后继续使用。",
      );
    if (this.state.status === "installing") return this.snapshot();
    const eligible =
      release &&
      newerVersion(release.version, this.state.currentVersion) &&
      (!this.state.minimumVersion ||
        !versionBelow(release.version, this.state.minimumVersion));
    // A stale notification cannot downgrade or discard a usable cached installer.
    if (
      this.release &&
      (!eligible || versionBelow(release!.version, this.release.version))
    )
      return this.snapshot();
    if (
      eligible &&
      this.release?.version === release.version &&
      this.release.artifact.sha512 === release.artifact.sha512 &&
      ["downloading", "downloaded"].includes(this.state.status)
    )
      return this.snapshot();
    if (this.release && this.release !== release) {
      ++this.revision;
      this.transport.cancel();
      this.transport.discard?.();
    }
    this.release = eligible ? release : undefined;
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
      progress: undefined,
      checkedAt: new Date().toISOString(),
    });
    return this.snapshot();
  }
  async check() {
    if (
      this.state.mode === "disabled" ||
      this.checking ||
      this.downloadPending ||
      this.state.status === "installing"
    )
      return this.snapshot();
    this.checking = true;
    const revision = ++this.checkRevision;
    const downloaded = this.state.status === "downloaded";
    if (!downloaded) this.patch({ status: "checking", error: undefined });
    try {
      const release = await this.transport.latest();
      if (revision === this.checkRevision) this.acceptRelease(release);
    } catch {
      if (revision === this.checkRevision) {
        if (!downloaded) {
          this.release = undefined;
          this.patch({
            status: "error",
            latestVersion: undefined,
            notes: undefined,
            error: "检查更新失败，请稍后重试。如持续失败，请从官网下载新版。",
          });
        }
      }
    } finally {
      this.checking = false;
    }
    return this.snapshot();
  }
  async download() {
    if (
      this.state.mode !== "install" ||
      !this.release ||
      (this.state.minimumVersion &&
        versionBelow(this.release.version, this.state.minimumVersion)) ||
      this.downloadPending ||
      !["available", "error"].includes(this.state.status)
    )
      throw new Error("请先检查可用更新");
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
      if (revision !== this.revision) this.patch({});
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
      throw new Error("请先退出房间并完成更新下载");
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
      if (this.release === release && this.snapshot().status === "installing")
        this.installFailed();
    }
  }
  downloadURL() {
    return this.release;
  }
  requireUpdate(minimumVersion: string, reason: string) {
    clientVersionSchema.parse(minimumVersion);
    if (
      !shouldAdvanceUpdateRequirement(
        this.state.currentVersion,
        this.state.minimumVersion,
        minimumVersion,
      )
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
      this.transport.discard?.();
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
