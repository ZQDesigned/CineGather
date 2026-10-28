import { _electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultSettings } from "../apps/desktop/src/shared/settings";

if (process.platform !== "win32" && process.platform !== "darwin")
  throw new Error("Run the packaged viewing-window check on a desktop host");
const executablePath =
  process.argv[2] ?? "apps/desktop/release/win-unpacked/CineGather.exe";
const profile = await mkdtemp(join(tmpdir(), "cg-viewing-window-"));
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    ...defaultSettings,
    autoDownloadUpdates: false,
    muteShortcut: "Control+Alt+Shift+F12",
  }),
);
const app = await _electron.launch({
  executablePath: resolve(executablePath),
  args: [`--user-data-dir=${profile}`, "--mute-audio"],
});
try {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  const main = await app.browserWindow(page);
  const childPromise = app.waitForEvent("window");
  await page.evaluate(() => {
    window.open(new URL("watch.html", location.href).href, "cinegather-watch");
  });
  const child = await childPromise;
  await child.waitForURL("**/watch.html");
  const owned = await app.browserWindow(child);
  const options = await owned.evaluate((w) => ({
    pinned: w.isAlwaysOnTop(),
    preferences: w.webContents.getLastWebPreferences(),
  }));
  expect(options.pinned).toBe(true);
  expect(options.preferences.sandbox).toBe(true);
  expect(options.preferences.contextIsolation).toBe(true);
  expect(options.preferences.nodeIntegration).toBe(false);
  expect(await child.evaluate(() => Boolean(window.desktop))).toBe(false);
  await page.evaluate(() =>
    window.desktop!.viewingWindow!.action("toggle-top"),
  );
  expect(await owned.evaluate((w) => w.isAlwaysOnTop())).toBe(false);
  await page.evaluate(() =>
    window.desktop!.viewingWindow!.action("toggle-top"),
  );
  expect(await owned.evaluate((w) => w.isAlwaysOnTop())).toBe(true);
  await main.evaluate((w) => w.minimize());
  await expect.poll(() => main.evaluate((w) => w.isMinimized())).toBe(true);
  expect(await owned.evaluate((w) => w.isVisible())).toBe(true);
  await page.evaluate(() => window.desktop!.viewingWindow!.action("return"));
  await expect.poll(() => child.isClosed()).toBe(true);
  await expect.poll(() => main.evaluate((w) => w.isMinimized())).toBe(false);
  expect(await main.evaluate((w) => w.isVisible())).toBe(true);
  const directory = resolve(".local/viewing-window-verification");
  await mkdir(directory, { recursive: true });
  const result = {
    platform: process.platform,
    packagedChildCreated: true,
    sandboxAndBridgeIsolation: true,
    pinToggle: true,
    visibleWhileMainMinimized: true,
    returnRestoresMain: true,
    productionAccountsCreated: false,
  };
  await writeFile(
    join(directory, process.platform + ".json"),
    JSON.stringify(result),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
