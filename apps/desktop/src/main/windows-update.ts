import {
  CancellationToken,
  type CustomPublishOptions,
} from "builder-util-runtime";
import { SignedReleaseProvider } from "./update-provider";
import { verifyInstaller, type Release } from "./update-release";
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
): Pick<UpdateTransport, "download" | "install" | "cancel"> {
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
    download: async (release, progress) => {
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
        downloaded = structuredClone(release);
      } finally {
        updater.removeListener("download-progress", listener);
      }
    },
    install: async () => {
      if (!installer || !downloaded) throw new Error("尚未下载更新");
      await verifyInstaller(installer, downloaded.artifact);
      await beforeInstall();
      updater.quitAndInstall(true, true);
    },
  };
}
