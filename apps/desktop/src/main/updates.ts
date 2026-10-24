import { app, shell } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NsisUpdater } from "electron-updater";
import type { UpdateStatus } from "@cinegather/contracts";
import {
  artifactURL,
  fetchRelease,
  updateMode,
  updateOrigin,
} from "./update-release";
import { versionBelow } from "@cinegather/contracts";
import { UpdateController, type UpdateTransport } from "./update-controller";
import { windowsDownloader } from "./windows-update";

export async function createUpdates(
  changed: (status: UpdateStatus) => void,
  beforeInstall: () => Promise<void>,
) {
  const resource = (file: string) => join(__dirname, "../../resources", file);
  const installed =
    process.platform === "win32" &&
    (await readFile(join(process.resourcesPath, "install-mode"), "utf8")
      .then((value) => value.trim() === "nsis")
      .catch(() => false));
  const mode = updateMode(
    process.platform,
    app.isPackaged,
    installed,
    Boolean(
      process.env.PORTABLE_EXECUTABLE_FILE ||
        process.env.PORTABLE_EXECUTABLE_DIR,
    ),
  );
  const publicKey = !app.isPackaged
    ? ""
    : await readFile(resource("update-public-key.pem"), "utf8");
  const updater = mode === "install" ? new NsisUpdater() : undefined;
  if (updater) {
    updater.updateConfigPath = resource("updater.yml");
    updater.on("error", (error) => {
      console.warn("Client update:", error.message);
      if (controller.snapshot().status === "installing")
        controller.installFailed();
    });
  }
  const unsupported = async () => {
    throw new Error("此版本不支持自动安装");
  };
  const transport: UpdateTransport = {
    latest: () => fetchRelease(publicKey, process.platform, process.arch),
    ...(updater
      ? windowsDownloader(updater, beforeInstall)
      : {
          download: unsupported,
          install: unsupported,
          cancel: () => {},
        }),
  };
  const controller = new UpdateController(
    mode,
    app.getVersion(),
    transport,
    changed,
  );
  const automatic = async () => {
    const status = await controller.check();
    if (
      status.status === "available" &&
      status.mode === "install" &&
      !status.inRoom
    )
      await controller.download().catch(() => {});
  };
  const start = setTimeout(() => void automatic(), 20000);
  const timer = setInterval(() => void automatic(), 6 * 60 * 60 * 1000);
  start.unref();
  timer.unref();
  app.once("before-quit", () => {
    clearTimeout(start);
    clearInterval(timer);
    transport.cancel();
  });
  return {
    controller,
    openDownload: async () => {
      const status = controller.snapshot();
      const portable =
        mode === "disabled" &&
        status.required &&
        app.isPackaged &&
        process.platform === "win32";
      const release = portable
        ? await fetchRelease(publicKey, process.platform, process.arch)
        : controller.downloadURL();
      if (
        !release ||
        (!portable &&
          mode !== "notify" &&
          !(mode === "install" && status.required)) ||
        (status.minimumVersion &&
          versionBelow(release.version, status.minimumVersion))
      )
        throw new Error("新版安装包暂不可用，请稍后重试。");
      const url = portable
        ? `${updateOrigin}/downloads/${release.artifact.file.replace("-setup.exe", "-portable.exe")}`
        : artifactURL(release);
      await shell.openExternal(url);
    },
  };
}
