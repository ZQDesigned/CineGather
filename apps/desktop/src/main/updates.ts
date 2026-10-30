import { app, shell, powerMonitor } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DiagnosticNsisUpdater } from "./installer-updater";
import {
  InstallerJournal,
  installerDiagnosticDirectory,
} from "./installer-diagnostics";
import type { UpdateStatus } from "@cinegather/contracts";
import {
  artifactURL,
  fetchRelease,
  updateMode,
  updateOrigin,
} from "./update-release";
import { versionBelow, clientPolicySchema } from "@cinegather/contracts";
import { UpdateController, type UpdateTransport } from "./update-controller";
import { watchUpdateEvents } from "@cinegather/client-core";
import { UpdateScheduler, automaticallyDownload } from "./update-scheduler";
import { PendingUpdateStore, installPendingUpdate } from "./pending-update";
import { verifyRelease } from "./update-release";
import { windowsDownloader } from "./windows-update";

export async function createUpdates(
  changed: (status: UpdateStatus) => void,
  beforeInstall: () => Promise<void>,
  options: { autoDownload?: boolean } = {},
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
  const pending =
    mode === "install"
      ? new PendingUpdateStore(
          join(app.getPath("userData"), "pending-update.json"),
          publicKey,
          process.platform,
          process.arch,
        )
      : undefined;
  const journal = new InstallerJournal(
    installerDiagnosticDirectory(),
    app.getVersion(),
  );
  journal.record("application-start", { path: process.execPath, scope: mode });
  app.on("before-quit", () => journal.record("application-before-quit"));
  app.on("will-quit", () => journal.record("application-will-quit"));
  const updater =
    mode === "install" ? new DiagnosticNsisUpdater(journal) : undefined;
  if (updater) {
    updater.updateConfigPath = resource("updater.yml");
    updater.on("error", (error) => {
      journal.record("updater-error", {
        code: (error as NodeJS.ErrnoException).code ?? "unknown",
      });
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
    minimum: async () => {
      const response = await fetch(`${updateOrigin}/api/v1/client-policy`, {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) return undefined;
      const policy = clientPolicySchema.parse(await response.json());
      return {
        version:
          policy.minimumVersions[
            process.platform === "win32" ? "win32" : "darwin"
          ],
        reason: policy.reason,
      };
    },
    ...(updater
      ? windowsDownloader(updater, beforeInstall, pending, (phase, details) =>
          journal.record(phase, details),
        )
      : {
          download: unsupported,
          install: unsupported,
          cancel: () => {},
        }),
  };
  let autoDownload = options.autoDownload ?? true;
  let ready = false;
  const automaticDownload = () => {
    void automaticallyDownload(controller, ready && autoDownload);
  };
  const controller = new UpdateController(
    mode,
    app.getVersion(),
    transport,
    (status) => {
      changed(status);
      queueMicrotask(automaticDownload);
    },
  );
  const startupInstalling = pending
    ? await installPendingUpdate(controller, transport, pending).catch(() => {
        controller.installFailed();
        return false;
      })
    : false;
  ready = !startupInstalling;
  const scheduler = new UpdateScheduler(() => controller.check());
  let stopEvents = Object.assign(() => {}, { reconnect: () => {} });
  const resume = () => {
    void scheduler.resume();
    stopEvents.reconnect();
  };
  if (ready && mode !== "disabled") {
    scheduler.start();
    powerMonitor.on("resume", resume);
    const url = new URL("/api/v1/client-events", updateOrigin);
    url.searchParams.set("platform", process.platform);
    url.searchParams.set("arch", process.arch);
    stopEvents = watchUpdateEvents(url.href, (event, raw) => {
      if (event === "release") {
        controller.acceptRelease(
          verifyRelease(raw, publicKey, process.platform, process.arch),
        );
        scheduler.checked();
      } else if (event === "policy") {
        const policy = clientPolicySchema.parse(JSON.parse(raw));
        const previous = controller.snapshot().minimumVersion;
        controller.requireUpdate(
          policy.minimumVersions[
            process.platform === "win32" ? "win32" : "darwin"
          ],
          policy.reason,
        );
        if (controller.snapshot().minimumVersion !== previous)
          void controller.check();
      }
    });
    automaticDownload();
  }
  app.once("before-quit", () => {
    ready = false;
    scheduler.stop();
    stopEvents();
    powerMonitor.removeListener("resume", resume);
    transport.cancel();
  });
  return {
    controller,
    check: async () => {
      const status = await controller.check();
      scheduler.checked();
      return status;
    },
    reconnect: () => stopEvents.reconnect(),
    startupInstalling,
    configure: (enabled: boolean) => {
      autoDownload = enabled;
      automaticDownload();
    },
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
