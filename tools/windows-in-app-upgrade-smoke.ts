import { _electron, expect, type ElectronApplication } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { windowsProcessIdentity } from "./windows-identity-probe";
import { windowsAppId } from "../apps/desktop/src/main/window-chrome";

if (process.platform !== "win32")
  throw Error("Run the installed update test on Windows");
const installer = resolve(process.argv[2]!);
if (!process.argv[2]) throw Error("Provide the newly built installer");
const directory = resolve(".local/windows-upgrade");
await mkdir(directory, { recursive: true });
const install = "D:\\CGPlat\\CineGather";
const executable = join(install, "CineGather.exe");
const powershell = (script: string) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { encoding: "utf8", timeout: 150_000 },
  ).trim();
const publicInstaller = join(directory, "CineGather-0.1.20-public-setup.exe");
powershell(
  `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://cgplat.zqdesigned.city/downloads/CineGather-0.1.20-win-x64-setup.exe' -OutFile '${publicInstaller}'; $p=Start-Process '${publicInstaller}' -ArgumentList @('/S','--updated','/D=${install}') -PassThru -Wait; if($p.ExitCode -ne 0){throw 'Baseline installation failed'}`,
);
interface Shortcut {
  kind: string;
  path: string;
  target: string;
  appId: string;
  sha256: string;
  created: string;
}
function shortcuts(removeDesktop = false): Shortcut[] {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve("tools/windows-shortcut-probe.ps1"),
      "-InstallDirectory",
      install,
      ...(removeDesktop ? ["-RemoveDesktop"] : []),
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  return JSON.parse(output);
}
const expectedPayload = createHash("sha256")
  .update(
    await readFile("apps/desktop/release/win-unpacked/resources/app.asar"),
  )
  .digest("hex");
const baselineShortcuts = shortcuts();
expect(baselineShortcuts.some((link) => link.kind === "start-menu")).toBe(true);
for (const link of baselineShortcuts) expect(link.appId).toBe(windowsAppId);
// Simulate the user's choice to delete the desktop shortcut. An upgrade must
// preserve that choice instead of recreating it as if this were a fresh install.
const before = shortcuts(true);
expect(before.some((link) => link.kind === "desktop")).toBe(false);
const results: unknown[] = [];
let application: ElectronApplication | undefined;
try {
  for (let round = 1; round <= 2; round++) {
    application = await _electron.launch({
      executablePath: executable,
      args: ["--mute-audio"],
    });
    const page = await application.firstWindow();
    await expect(page.locator(".app")).toBeVisible();
    const identityBefore = await windowsProcessIdentity(application);
    const log = join(directory, `in-app-upgrade-${round}-launch.json`);
    const closed = application.waitForEvent("close", { timeout: 90_000 });
    await application.evaluate(
      (_electron, options) => {
        const entry = (process as NodeJS.Process & { mainModule: NodeModule })
          .mainModule;
        const load = entry.require.bind(entry);
        const { NsisUpdater } = load(options.module);
        const { writeFileSync } = load("node:fs") as typeof import("node:fs");
        const updater = new NsisUpdater();
        // Replace only the already-verified download cache in this fixture. The
        // actual quitAndInstall/doInstall/spawn and NSIS uninstall paths run intact.
        updater.downloadedUpdateHelper = {
          file: options.installer,
          packageFile: null,
          downloadedFileInfo: { isAdminRightsRequired: false },
        };
        updater.installDirectory = options.install;
        updater.autoInstallOnAppQuit = false;
        updater.on("error", (error: Error) =>
          writeFileSync(options.log + ".error", error.message),
        );
        const spawn = updater.spawnLog.bind(updater);
        updater.spawnLog = (file: string, args: string[]) => {
          writeFileSync(options.log, JSON.stringify({ file, args }));
          return spawn(file, args);
        };
        setTimeout(() => updater.quitAndInstall(true, true), 200);
      },
      {
        module: resolve("node_modules/electron-updater/out/NsisUpdater.js"),
        installer,
        install,
        log,
      },
    );
    await closed;
    application = undefined;
    const launch = JSON.parse(await readFile(log, "utf8"));
    expect(launch.args).toEqual(
      expect.arrayContaining([
        "--updated",
        "/S",
        "--force-run",
        `/D=${install}`,
      ]),
    );
    await expect
      .poll(
        async () => {
          try {
            const payload = createHash("sha256")
              .update(await readFile(join(install, "resources/app.asar")))
              .digest("hex");
            const running = powershell(
              `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${installer}' }).Count`,
            );
            return payload === expectedPayload && running === "0";
          } catch {
            return false;
          }
        },
        { timeout: 120_000, intervals: [1000, 2000, 3000] },
      )
      .toBe(true);
    // The real updater requested a restart. Close only this fixture's restarted
    // installation before attaching a fresh instrumented verification process.
    powershell(
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${executable}' } | ForEach-Object { & taskkill /F /T /PID $_.ProcessId 2>$null | Out-Null }; exit 0`,
    );
    application = await _electron.launch({
      executablePath: executable,
      args: ["--mute-audio"],
    });
    await expect(
      (await application.firstWindow()).locator(".app"),
    ).toBeVisible();
    const identityAfter = await windowsProcessIdentity(application);
    expect(identityAfter).toMatchObject({ hresult: 0, identity: windowsAppId });
    await application.close();
    application = undefined;
    const after = shortcuts();
    expect(after).toEqual(before);
    results.push({
      round,
      identityBefore,
      identityAfter,
      shortcutsUnchanged: true,
      deletedDesktopNotRecreated: true,
      actualQuitAndInstall: true,
      installerArguments: launch.args,
      actualTaskbarPinsOnRunner: before.filter(
        (link) => link.kind === "taskbar",
      ).length,
    });
    await writeFile(
      join(directory, "in-app-upgrade.json"),
      JSON.stringify(results, null, 2),
    );
  }
  const uninstaller = join(install, "Uninstall CineGather.exe");
  powershell(
    `$ErrorActionPreference='Stop'; $p=Start-Process '${uninstaller}' -ArgumentList @('/S') -PassThru -Wait; if($p.ExitCode -ne 0){throw 'Normal uninstall failed'}`,
  );
  await expect.poll(() => shortcuts(), { timeout: 60_000 }).toEqual([]);
  results.push({ normalUninstallRemovesShortcuts: true });
  await writeFile(
    join(directory, "in-app-upgrade.json"),
    JSON.stringify(results, null, 2),
  );
} finally {
  await application?.close().catch(() => {});
}
console.log(
  JSON.stringify({
    inAppUpgradeRounds: 2,
    runtimeAndShortcutIdentityMatch: true,
    shortcutsUnchanged: true,
    taskbarPositionNeedsInteractiveUserVerification: true,
  }),
);
