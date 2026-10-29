import { _electron, expect, type ElectronApplication } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultSettings } from "../apps/desktop/src/shared/settings";
const profile = await mkdtemp(join(tmpdir(), "cg-dnd-"));
const file = join(profile, "settings.json");
await writeFile(
  file,
  JSON.stringify({
    ...defaultSettings,
    autoDownloadUpdates: false,
    pttShortcut: "Control+Alt+Shift+F7",
    muteShortcut: "Control+Alt+Shift+F8",
  }),
);
const launch = () =>
  _electron.launch({
    ...(process.argv[2] ? { executablePath: resolve(process.argv[2]) } : {}),
    args: [
      ...(process.argv[2] ? [] : [resolve("apps/desktop/out/main/index.cjs")]),
      "--user-data-dir=" + profile,
      "--mute-audio",
    ],
  });
let app: ElectronApplication | undefined;
try {
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  await app.evaluate(({ Tray }) => {
    const original = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (menu) {
      Object.assign(globalThis, { dndTestMenu: menu });
      return original.call(this, menu);
    };
  });
  await page.evaluate(async () => {
    const s = await window.desktop!.loadSettings();
    await window.desktop!.saveSettings(s);
  });
  const checked = () =>
    app!.evaluate(({ app }) => {
      const menu =
        process.platform === "darwin"
          ? app.dock?.getMenu()
          : (globalThis as unknown as { dndTestMenu?: Electron.Menu })
              .dndTestMenu;
      const item = menu?.getMenuItemById("do-not-disturb");
      return item
        ? { label: item.label, type: item.type, checked: item.checked }
        : null;
    });
  expect(await checked()).toEqual({
    label: "免打扰",
    type: "checkbox",
    checked: false,
  });
  const stale = await page.evaluate(() => window.desktop!.loadSettings());
  await page.getByRole("button", { name: "开启免打扰", exact: true }).click();
  await expect.poll(checked).toMatchObject({ checked: true });
  const main = await app.browserWindow(page);
  await main.evaluate((w) => w.hide());
  const clickMenu = () =>
    app!.evaluate(({ app }) => {
      const menu =
        process.platform === "darwin"
          ? app.dock?.getMenu()
          : (globalThis as unknown as { dndTestMenu: Electron.Menu })
              .dndTestMenu;
      const item = menu!.getMenuItemById("do-not-disturb")!;
      item.click(item, undefined, {} as Electron.KeyboardEvent);
    });
  await clickMenu();
  await expect.poll(checked).toMatchObject({ checked: false });
  await expect(
    page.getByRole("button", { name: "开启免打扰", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await main.evaluate((w) => w.isVisible() || w.isFocused())).toBe(
    false,
  );
  await clickMenu();
  await expect.poll(checked).toMatchObject({ checked: true });
  await page.evaluate(async (s) => {
    await window.desktop!.saveSettings({
      ...s,
      notifications: { ...s.notifications!, volume: 73 },
    });
  }, stale);
  expect(
    (await page.evaluate(() => window.desktop!.loadSettings())).notifications,
  ).toMatchObject({ doNotDisturb: true, volume: 73 });
  await main.evaluate((w) => w.show());
  await expect(
    page.getByRole("button", { name: "关闭免打扰", exact: true }),
  ).toBeInViewport();
  await mkdir(".local/do-not-disturb-verification", { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({
    path: ".local/do-not-disturb-verification/" + process.platform + ".png",
  });
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "免打扰", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.desktop!.notifications!.setDoNotDisturb!(false),
  );
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(checked).toMatchObject({ checked: false });
  const saved = await readFile(file, "utf8");
  await rm(file);
  await mkdir(file);
  const rejected = await page.evaluate(async () => {
    try {
      await window.desktop!.notifications!.setDoNotDisturb!(true);
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  expect(
    (await page.evaluate(() => window.desktop!.loadSettings())).notifications!
      .doNotDisturb,
  ).toBe(false);
  await rm(file, { recursive: true });
  await writeFile(file, saved);
  await page.evaluate(async () => {
    const bridge = window.desktop!.notifications!;
    await Promise.all([
      bridge.setDoNotDisturb!(true),
      bridge.setDoNotDisturb!(false),
      bridge.setDoNotDisturb!(true),
    ]);
  });
  await expect.poll(checked).toMatchObject({ checked: true });
  expect(
    JSON.parse(await readFile(file, "utf8")).notifications.doNotDisturb,
  ).toBe(true);
  const invalid = await page.evaluate(async () => {
    try {
      await window.desktop!.notifications!.setDoNotDisturb!(
        "yes" as unknown as boolean,
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(invalid).toBe(true);
  await app.close();
  app = undefined;
  app = await launch();
  await expect(
    (await app.firstWindow()).getByRole("button", {
      name: "关闭免打扰",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  const result = {
    platform: process.platform,
    nativeMenu: process.platform === "darwin" ? "dock" : "tray",
    nativeMenuAndTopbarSynchronized: true,
    nativeBackgroundToggleDoesNotActivateWindow: true,
    staleSettingsDraftPreservesDoNotDisturb: true,
    failedPersistencePreservesStateAndQueueRecovers: true,
    concurrentWritesSerialized: true,
    survivesRestart: true,
    invalidInputRejected: true,
    productionDataCreated: false,
  };
  await mkdir(".local/do-not-disturb-verification", { recursive: true });
  await writeFile(
    ".local/do-not-disturb-verification/" + process.platform + ".json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
