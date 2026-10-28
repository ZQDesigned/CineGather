import { _electron, expect } from "@playwright/test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { defaultSettings } from "../apps/desktop/src/shared/settings";
const profile = await mkdtemp(join(tmpdir(), "cg-notification-"));
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    ...defaultSettings,
    autoDownloadUpdates: false,
    pttShortcut: "Control+Alt+Shift+F7",
    muteShortcut: "Control+Alt+Shift+F8",
  }),
);
const app = await _electron.launch({
  ...(process.argv[2] ? { executablePath: resolve(process.argv[2]) } : {}),
  args: [
    ...(process.argv[2] ? [] : [resolve("apps/desktop/out/main/index.cjs")]),
    "--user-data-dir=" + profile,
    "--mute-audio",
  ],
});
try {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { notificationActivationProbe: events });
    window.desktop!.notifications!.onActivate((id, scope) =>
      events.push({ id, scope }),
    );
  });
  await app.evaluate(({ Notification }) => {
    const instances: InstanceType<typeof Notification>[] = [],
      events: unknown[] = [];
    const original = Notification.prototype.show;
    Object.assign(globalThis, {
      notificationSmoke: { instances, events, original },
    });
    Notification.prototype.show = function () {
      instances.push(this);
      this.emit("failed", {}, "unsigned compatibility fixture");
    };
  });
  const main = await app.browserWindow(page);
  await main.evaluate((w) => w.hide());
  const cardPromise = app.waitForEvent("window");
  await page.evaluate(() =>
    window.desktop!.notifications!.show({
      id: "one",
      scope: "local-smoke",
      title: "后台提醒",
      body: "兼容通知验证",
    }),
  );
  const card = await cardPromise;
  await expect(card.getByText("兼容通知验证")).toBeVisible();
  const owned = await app.browserWindow(card);
  expect(await owned.evaluate((w) => w.isFocused())).toBe(false);
  expect(await main.evaluate((w) => w.isVisible())).toBe(false);
  expect(await owned.evaluate((w) => w.isContentProtected())).toBe(false);
  const prefs = await owned.evaluate((w) =>
    w.webContents.getLastWebPreferences(),
  );
  expect(prefs.sandbox).toBe(true);
  expect(prefs.nodeIntegration).toBe(false);
  expect(prefs.contextIsolation).toBe(true);
  expect(await card.evaluate(() => Boolean(window.desktop))).toBe(false);
  await page.evaluate(() => window.desktop!.setSharing(true));
  await page.evaluate(() =>
    window.desktop!.notifications!.show({
      id: "private",
      scope: "local-smoke",
      title: "隐私姓名",
      body: "秘密消息正文",
    }),
  );
  await expect(card.getByText("收到一条新提醒")).toBeVisible();
  await expect(card.getByText("秘密消息正文")).toHaveCount(0);
  await card.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { notificationActivationProbe: unknown[] })
            .notificationActivationProbe,
      ),
    )
    .toEqual([{ id: "private", scope: "local-smoke" }]);
  await expect.poll(() => main.evaluate((w) => w.isVisible())).toBe(true);
  await page.evaluate(async () => {
    await window.desktop!.setSharing(false);
    await window.desktop!.notifications!.clear();
  });
  await app.evaluate(() => {
    const smoke = (
      globalThis as unknown as {
        notificationSmoke: { instances: { emit(name: string): void }[] };
      }
    ).notificationSmoke;
    for (const n of smoke.instances) n.emit("click");
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { notificationActivationProbe: unknown[] })
          .notificationActivationProbe.length,
    ),
  ).toBe(1);
  const invalid = await page.evaluate(async () => {
    try {
      await window.desktop!.notifications!.show({
        id: "bad",
        scope: "local-smoke",
        title: "a".repeat(121),
      });
      return false;
    } catch {
      return true;
    }
  });
  expect(invalid).toBe(true);
  await page.evaluate(async () => {
    const s = await window.desktop!.loadSettings();
    await window.desktop!.saveSettings({
      ...s,
      notifications: { ...s.notifications!, doNotDisturb: true },
    });
  });
  await main.evaluate((w) => w.hide());
  await page.evaluate(() =>
    window.desktop!.notifications!.show({
      id: "dnd",
      scope: "local-smoke",
      title: "不要提醒",
    }),
  );
  expect(await owned.evaluate((w) => w.isVisible())).toBe(false);
  await page.evaluate(async () => {
    const s = await window.desktop!.loadSettings();
    await window.desktop!.saveSettings({
      ...s,
      notifications: { ...s.notifications!, doNotDisturb: false },
    });
  });
  await app.evaluate(({ Notification }) => {
    const smoke = (
      globalThis as unknown as {
        notificationSmoke: {
          original: typeof Notification.prototype.show;
          events: unknown[];
        };
      }
    ).notificationSmoke;
    Notification.prototype.show = function () {
      this.once("show", () => smoke.events.push({ event: "show" }));
      this.once("failed", (_event, error) =>
        smoke.events.push({
          event: "failed",
          reason: String(error).slice(0, 200),
        }),
      );
      smoke.original.call(this);
    };
  });
  await page.evaluate(() =>
    window.desktop!.notifications!.show({
      id: "native",
      scope: "local-smoke",
      title: "映聚通知测试",
      body: "系统通知能力验证",
    }),
  );
  await page.waitForTimeout(1500);
  const native = await app.evaluate(
    () =>
      (globalThis as unknown as { notificationSmoke: { events: unknown[] } })
        .notificationSmoke.events,
  );
  if (process.platform === "darwin" && process.argv[2]) {
    const signed =
      spawnSync("/usr/bin/codesign", [
        "--verify",
        "--strict",
        resolve(process.argv[2], "../../.."),
      ]).status === 0;
    if (!signed)
      await expect(
        card.getByText("系统通知能力验证", { exact: true }),
      ).toBeVisible();
  }
  await app.evaluate(({ app }) => app.removeAllListeners("window-all-closed"));
  await main.evaluate((window) => window.destroy());
  await expect.poll(() => card.isClosed(), { timeout: 3000 }).toBe(true);
  const result = {
    ownedCardClosesWithMain: true,
    platform: process.platform,
    backgroundFallbackVisible: true,
    doesNotStealFocus: true,
    clickRestoresMainAndActivates: true,
    staleClickIgnoredAfterClear: true,
    sharingPreviewHidden: true,
    doNotDisturb: true,
    isolatedCardBridge: true,
    invalidInputRejected: true,
    nativeAttempt: native,
    productionDataCreated: false,
  };
  await mkdir(".local/notification-verification", { recursive: true });
  await writeFile(
    ".local/notification-verification/" + process.platform + ".json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
