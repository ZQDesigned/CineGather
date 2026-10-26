import { _electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultSettings } from "../apps/desktop/src/shared/settings";
if (process.platform !== "win32")
  throw new Error("Run this packaged caption test on Windows");
const profile = await mkdtemp(join(tmpdir(), "cg-caption-"));
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    ...defaultSettings,
    minimizeToTray: true,
    muteShortcut: "Control+Alt+Shift+F11",
  }),
);
const app = await _electron.launch({
  executablePath: resolve("apps/desktop/release/win-unpacked/CineGather.exe"),
  args: [`--user-data-dir=${profile}`],
});
try {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toHaveAttribute("data-platform", "win32");
  expect(
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null),
  ).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.show();
    w.focus();
    w.webContents.sendInputEvent({ type: "keyDown", keyCode: "Alt" });
    w.webContents.sendInputEvent({ type: "keyUp", keyCode: "Alt" });
  });
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.isMenuBarVisible(),
    ),
  ).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (
            navigator as Navigator & {
              windowControlsOverlay?: { visible: boolean };
            }
          ).windowControlsOverlay?.visible,
        ),
      ),
    )
    .toBe(false);
  await expect(page.getByRole("group", { name: "窗口控制" })).toBeVisible();
  for (const name of ["最小化", "最大化", "关闭窗口"]) {
    await page.getByRole("button", { name, exact: true }).hover();
    // Wait beyond AntD's hover delay to catch accidental Tooltip wrappers.
    await page.waitForTimeout(500);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  await page.mouse.move(0, 0);
  // Produce a real error Notification without sending a login attempt online.
  let intercepted = false;
  await page.route("**/api/v1/accounts/login", (route) => {
    intercepted = true;
    return route.fulfill({
      status: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        code: "NOTIFICATION_LAYOUT_TEST",
        message: "通知布局测试（本地拦截）",
      },
    });
  });
  await page
    .getByLabel("用户名", { exact: true })
    .fill("notification_layout_test");
  await page.getByLabel("密码", { exact: true }).fill("Local layout test 123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const notice = page.locator(".ant-notification-notice");
  await expect(notice).toBeVisible();
  expect(intercepted).toBe(true);
  await expect
    .poll(async () => {
      const notification = await notice.boundingBox();
      const header = await page.locator(".topbar").boundingBox();
      return notification && header
        ? notification.y - header.y - header.height
        : -1;
    })
    .toBeGreaterThanOrEqual(16);
  for (const width of [980, 1360]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width, height: 760 }),
      width,
    );
    await expect
      .poll(() =>
        page.locator(".window-controls").evaluate((el) => {
          const controls = el.getBoundingClientRect();
          const version = document
            .querySelector(".version")!
            .getBoundingClientRect();
          return (
            controls.left > version.right &&
            controls.right <= innerWidth &&
            controls.bottom <= 56
          );
        }),
      )
      .toBe(true);
  }
  await page.getByRole("button", { name: "最大化", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "还原窗口", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isMaximized(),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "还原窗口", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isMaximized(),
      ),
    )
    .toBe(false);
  await page.getByRole("button", { name: "最小化", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isMinimized(),
      ),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.restore();
    w.show();
  });
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.isVisible(),
    ),
  ).toBe(false);
  const directory = resolve(".local/window-chrome-verification");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "win32.json"),
    JSON.stringify({
      platform: process.platform,
      menusRemoved: true,
      captionOverlayVisible: false,
      frontendControlsInLayout: true,
      notificationBelowHeader: true,
      captionTooltipsAbsent: true,
      maximizeRestoreAndMinimize: true,
      closeToTray: true,
    }),
  );
  console.log(
    "Packaged Windows frontend controls and native window lifecycle verified",
  );
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
