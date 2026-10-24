import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { registerTestAccount } from "./helpers/account";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

test("native member overlay appears only in a room and uses an isolated transparent non-activating window", async ({
  browser,
}) => {
  test.skip(
    process.platform === "linux",
    "Native transparent window test runs on macOS/Windows.",
  );
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), "cg-member-overlay-"));
  await writeFile(
    join(profile, "settings.json"),
    JSON.stringify({
      ...defaultSettings,
      muteShortcut: "Control+Alt+Shift+F9",
      minimizeToTray: true,
    }),
  );
  const app = await electron.launch({
    args: [
      resolve("apps/desktop"),
      `--user-data-dir=${profile}`,
      "--use-fake-device-for-media-stream",
      "--mute-audio",
    ],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  const other = await browser.newContext({ permissions: ["microphone"] });
  try {
    const page = await app.firstWindow();
    await page.waitForURL("app://cinegather/index.html");
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: "登录映聚", exact: true }).waitFor();
    await page.evaluate(() =>
      localStorage.setItem("cinegather.api", "http://127.0.0.1:14310"),
    );
    await page.reload();
    await registerTestAccount(page, "浮层实机成员");
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "成员浮层", exact: true }).click();
    await expect(
      page.getByRole("switch", { name: "显示房间成员浮层", exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("透明浮层实机验证");
    const overlayOpened = app.waitForEvent("window", {
      predicate: (p) => p !== page,
    });
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    const overlay = await overlayOpened;
    await expect(
      overlay.getByText("浮层实机成员", { exact: true }),
    ).toBeVisible();
    expect(await overlay.evaluate(() => window.desktop)).toBeUndefined();
    expect(
      await overlay.evaluate(() => localStorage.getItem("cinegather.session")),
    ).toBeNull();
    expect(
      await overlay.evaluate(async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          return "allowed";
        } catch {
          return "denied";
        }
      }),
    ).toBe("denied");
    expect(
      await overlay.evaluate(async () => {
        try {
          await fetch("http://127.0.0.1:14310/api/v1/health");
          return "allowed";
        } catch {
          return "denied";
        }
      }),
    ).toBe("denied");
    const state = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "映聚成员浮层",
      )!;
      const bitmap = (await w.webContents.capturePage()).toBitmap();
      return {
        cornerAlpha: bitmap[3],
        visible: w.isVisible(),
        focusable: w.isFocusable(),
        top: w.isAlwaysOnTop(),
      };
    });
    expect(state).toMatchObject({
      visible: true,
      focusable: false,
      top: true,
      cornerAlpha: 0,
    });
    await overlay.screenshot({
      path: ".local/member-overlay/native-alone.png",
      omitBackground: true,
    });
    const friend = await other.newPage();
    await friend.goto("/");
    await registerTestAccount(friend, "浮层远端成员");
    await friend
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await expect(
      friend.getByRole("tab", { name: "成员浮层", exact: true }),
    ).toHaveCount(0);
    await friend.getByRole("button", { name: "取消", exact: true }).click();
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend.getByLabel("房间号或邀请链接").fill(code);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    const remote = overlay.getByRole("listitem", {
      name: "浮层远端成员",
      exact: true,
    });
    await expect(remote).toBeVisible();
    await expect(
      remote.getByLabel("麦克风已开启").or(remote.getByLabel("正在说话")),
    ).toBeVisible();
    await friend
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await expect(remote.getByLabel("麦克风已关闭")).toBeVisible();
    await friend.evaluate(() => {
      // A controlled canvas avoids recording the user's real desktop in regression tests.
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#715a9e";
        context.fillRect(0, 0, 640, 360);
        return canvas.captureStream(5);
      };
    });
    await friend
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await friend
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await expect(remote.getByLabel("正在共享")).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "加入观看", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.srcObject),
    ).toBeNull();
    await friend
      .locator(".controls")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(remote.getByLabel("正在共享")).toHaveCount(0);
    await page.getByRole("menuitem", { name: /^我的房间/ }).click();
    await expect(
      overlay.getByText("浮层远端成员", { exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "映聚 CineGather")!
        .hide(),
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "映聚成员浮层")!
          .isVisible(),
      ),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "映聚 CineGather")!
        .show(),
    );
    await page
      .getByRole("button", { name: "返回当前房间", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "成员浮层", exact: true }).click();
    const enabled = page.getByRole("switch", {
      name: "显示房间成员浮层",
      exact: true,
    });
    await enabled.click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "映聚成员浮层")!
            .isVisible(),
        ),
      )
      .toBe(false);
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "成员浮层", exact: true }).click();
    await enabled.click();
    await page
      .getByRole("slider", { name: "浮层不透明度", exact: true })
      .focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "映聚成员浮层")!
            .getOpacity(),
        ),
      )
      .toBeCloseTo(0.31, 2);
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "成员浮层", exact: true }).click();
    const previousPosition = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "映聚成员浮层")!
        .getPosition(),
    );
    await page.getByRole("combobox", { name: "浮层位置", exact: true }).click();
    await page.getByRole("option", { name: "左侧居中", exact: true }).click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow, screen }) => {
          const w = BrowserWindow.getAllWindows().find(
            (w) => w.getTitle() === "映聚成员浮层",
          )!;
          const main = BrowserWindow.getAllWindows().find(
            (w) => w.getTitle() === "映聚 CineGather",
          )!;
          const area = screen.getDisplayMatching(main.getBounds()).workArea;
          return {
            actual: w.getBounds(),
            expected: {
              x: area.x + 8,
              y: Math.round(area.y + (area.height - w.getBounds().height) / 2),
              width: 256,
              height: 118,
            },
          };
        }),
      )
      .toMatchObject({ actual: { width: 256, height: 118 } });
    const placed = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "映聚成员浮层",
      )!;
      const main = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "映聚 CineGather",
      )!;
      const area = screen.getDisplayMatching(main.getBounds()).workArea;
      return {
        actual: w.getPosition(),
        expected: [
          area.x + 8,
          Math.round(area.y + (area.height - w.getBounds().height) / 2),
        ],
      };
    });
    expect(placed.actual).toEqual(placed.expected);
    expect(placed.actual).not.toEqual(previousPosition);
    expect(
      await page.evaluate(() => window.desktop!.loadSettings()),
    ).toHaveProperty("memberOverlay.position", "left-center");
    await expect(overlay.getByRole("button")).toHaveCount(0);
    // A lock hides the overlay immediately; unlock restores the latest room snapshot.
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "映聚成员浮层")!
            .isVisible(),
        ),
      )
      .toBe(false);
    await app.evaluate(({ powerMonitor }) =>
      powerMonitor.emit("unlock-screen"),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "映聚成员浮层")!
            .isVisible(),
        ),
      )
      .toBe(true);
    await friend.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(remote).toHaveCount(0);
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter(
              (w) => w.getTitle() === "映聚成员浮层" && w.isVisible(),
            ).length,
        ),
      )
      .toBe(0);
  } finally {
    try {
      await other.close();
    } finally {
      try {
        await app.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  }
});
