import {
  CancellationToken,
  type CustomPublishOptions,
} from "builder-util-runtime";
import { SignedReleaseProvider } from "./update-provider";
import { verifyInstaller, type Release } from "./update-release";
import type { PendingUpdateStore } from "./pending-update";
import type { UpdateTransport } from "./update-controller";

interface WindowsUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  disableWebInstaller: boolean;
  setFeedURL(config: CustomPublishOptions): void;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(token: CancellationToken): Promise<string[]>;
  on(
    event: "download-progress",
    listener: (event: { percent: number }) => void,
  ): unknown;
  removeListener(
    event: "download-progress",
    listener: (event: { percent: number }) => void,
  ): unknown;
  quitAndInstall(silent: boolean, restart: boolean): void;
}
export function windowsDownloader(
  updater: WindowsUpdater,
  beforeInstall: () => Promise<void>,
  pending?: PendingUpdateStore,
  trace?: (phase: string, details: Record<string, unknown>) => void,
): Pick<UpdateTransport, "download" | "install" | "cancel" | "discard"> {
  const note = (phase: string, details: Record<string, unknown> = {}) => {
    try {
      trace?.(phase, details);
    } catch {
      /* Diagnostics never block updating. */
    }
  };
  let cancellation: CancellationToken | undefined;
  let downloaded: Release | undefined;
  let installer: string | undefined;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableWebInstaller = true;
  return {
    cancel: () => cancellation?.cancel(),
    discard: () => pending?.clear(),
    download: async (release, progress) => {
      note("download-requested", { targetVersion: release.version });
      downloaded = undefined;
      installer = undefined;
      cancellation = new CancellationToken();
      const config: CustomPublishOptions & { release: Release } = {
        provider: "custom",
        updateProvider: SignedReleaseProvider,
        release,
      };
      updater.setFeedURL(config);
      const result = await updater.checkForUpdates();
      if (cancellation.cancelled) throw new Error("下载已取消");
      if (!result || result.updateInfo.version !== release.version)
        throw new Error("更新已失效");
      const listener = (event: { percent: number }) => progress(event.percent);
      updater.on("download-progress", listener);
      try {
        const files = await updater.downloadUpdate(cancellation);
        installer = files[0];
        if (cancellation.cancelled || !installer) throw new Error("下载已取消");
        await verifyInstaller(installer, release.artifact);
        if (cancellation.cancelled) throw new Error("下载已取消");
        pending?.save(release, installer);
        downloaded = structuredClone(release);
        note("download-verified", {
          targetVersion: release.version,
          path: installer,
        });
      } finally {
        updater.removeListener("download-progress", listener);
      }
    },
    install: async (allowed = () => true) => {
      if (!installer || !downloaded) throw new Error("尚未下载更新");
      note("install-requested", {
        targetVersion: downloaded.version,
        path: installer,
      });
      let stage = "installer-verification";
      try {
        await verifyInstaller(installer, downloaded.artifact);
        note("installer-verified", {
          targetVersion: downloaded.version,
          path: installer,
        });
        if (!allowed()) throw new Error("更新要求已改变，请重新检查新版");
        stage = "cleanup";
        note("cleanup-started");
        await beforeInstall();
        note("cleanup-complete");
        if (!allowed()) throw new Error("更新要求已改变，请重新检查新版");
        pending?.clear();
        stage = "handoff";
        note("installer-handoff", {
          targetVersion: downloaded.version,
          path: installer,
        });
        updater.quitAndInstall(true, true);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        note(stage + "-failed", {
          code: typeof code === "string" ? code.slice(0, 100) : "unknown",
        });
        throw error;
      }
    },
  };
}
