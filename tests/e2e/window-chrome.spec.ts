import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerTestAccount } from "./helpers/account";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

test("frontend Windows controls occupy header layout and follow window state", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const listeners = new Set<(state: { maximized: boolean }) => void>();
    let maximized = false;
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        platform: "win32",
        windowControls: {
          state: async () => ({ maximized }),
          onState: (callback: (state: { maximized: boolean }) => void) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
          action: async (action: string) => {
            document.documentElement.dataset.windowAction = action;
            if (action === "toggle-maximize") {
              maximized = !maximized;
              listeners.forEach((callback) => callback({ maximized }));
            }
          },
        },
      },
    });
    const { update } = await import("/store.ts" as string);
    update({ cinema: false });
  });
  const controls = page.getByRole("group", { name: "窗口控制" });
  await expect(controls).toBeVisible();
  await page.evaluate(async () => {
    const { update } = await import("/store.ts" as string);
    update({
      warningTitle: "通知布局测试",
      warning: "通知应显示在顶栏下方，窗口按钮保持可操作。",
    });
  });
  const notification = page.locator(".ant-notification-notice");
  await expect(notification).toBeVisible();
  await expect
    .poll(
      async () => {
        const notice = await notification.boundingBox();
        const header = await page.locator(".topbar").boundingBox();
        return notice && header ? notice.y - header.y - header.height : -1;
      },
      { timeout: 2000 },
    )
    .toBeGreaterThanOrEqual(16);
  await controls.getByRole("button", { name: "最大化", exact: true }).click();
  await expect(
    controls.getByRole("button", { name: "还原窗口", exact: true }),
  ).toBeVisible();
  await controls.getByRole("button", { name: "还原窗口", exact: true }).click();
  await expect(
    controls.getByRole("button", { name: "最大化", exact: true }),
  ).toBeVisible();
  for (const [name, action] of [
    ["最小化", "minimize"],
    ["关闭窗口", "close"],
  ]) {
    await controls.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-window-action",
      action!,
    );
  }
  for (const width of [980, 1360]) {
    await page.setViewportSize({ width, height: 760 });
    const bounds = await page.locator(".topbar").evaluate((header) => {
      const rect = (selector: string) =>
        header.querySelector(selector)!.getBoundingClientRect();
      const version = rect(".version"),
        controls = rect(".window-controls");
      return {
        versionRight: version.right,
        controlsLeft: controls.left,
        controlsRight: controls.right,
        width: innerWidth,
        bottom: controls.bottom,
        headerBottom: header.getBoundingClientRect().bottom,
      };
    });
    expect(bounds.versionRight).toBeLessThan(bounds.controlsLeft);
    expect(bounds.controlsRight).toBeLessThanOrEqual(bounds.width);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.headerBottom);
  }
  await page.evaluate(async () => {
    const { update } = await import("/store.ts" as string);
    update({ cinema: true });
  });
  await expect(controls).toBeVisible();
  for (const platform of ["darwin", "browser"]) {
    await page.evaluate(async (platform) => {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: platform === "browser" ? undefined : { platform },
      });
      const { update } = await import("/store.ts" as string);
      update({ cinema: false });
    }, platform);
    await expect(controls).toHaveCount(0);
    await expect(page.locator(".topbar")).toBeVisible();
  }
});

test("busy Windows header keeps long room names, inboxes and controls inside the window", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "顶栏布局回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page
    .getByLabel("房间名称")
    .fill("这是一个较长的房间名称，用于检查窗口按钮与业务入口的布局");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "离开房间", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: /^我的房间/ }).click();
  await page.evaluate(async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        platform: "win32",
        windowControls: {
          state: async () => ({ maximized: false }),
          action: async () => {},
          onState: () => () => {},
        },
      },
    });
    const { update } = await import("/store.ts" as string);
    update({
      roomState: "reconnecting",
      roomInvitations: [
        {
          id: crypto.randomUUID(),
          roomId: crypto.randomUUID(),
          roomName: "邀请布局",
          senderId: crypto.randomUUID(),
          senderName: "朋友",
          token: "x".repeat(32),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      ],
      roomJoinRequests: [
        {
          id: crypto.randomUUID(),
          userId: crypto.randomUUID(),
          displayName: "朋友",
          incoming: true,
          status: "pending",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      ],
    });
  });
  try {
    for (const width of [980, 1150, 1360]) {
      await page.setViewportSize({ width, height: 760 });
      await expect(
        page.getByRole("button", { name: "关闭窗口", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "退出当前房间", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const bounds = await page.locator(".topbar").evaluate((header) => {
        const children = [
          ...header.querySelector(".topbar-right")!.children,
        ].map((el) => el.getBoundingClientRect());
        return {
          inside: children.every(
            (rect) =>
              rect.left >= header.getBoundingClientRect().left &&
              rect.right <= innerWidth &&
              rect.bottom <= header.getBoundingClientRect().bottom,
          ),
          separate: children.every(
            (rect, index) =>
              index === 0 || rect.left >= children[index - 1]!.right,
          ),
        };
      });
      expect(bounds).toEqual({ inside: true, separate: true });
      await page.screenshot({
        path: `.local/frontend-window-controls/layout-${width}.png`,
      });
    }
  } finally {
    await page.evaluate(async () => {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: undefined,
      });
      const { update } = await import("/store.ts" as string);
      update({ roomInvitations: [], roomJoinRequests: [] });
      const { roomSession } = await import("/controller.ts" as string);
      await roomSession.leave();
    });
  }
});

test("native window chrome keeps menus, caption behavior and close-to-tray consistent with the platform", async () => {
  test.skip(
    !["darwin", "win32"].includes(process.platform),
    "Requires a supported desktop host",
  );
  const profile = await mkdtemp(join(tmpdir(), "cg-window-chrome-"));
  await writeFile(
    join(profile, "settings.json"),
    JSON.stringify({
      ...defaultSettings,
      minimizeToTray: true,
      muteShortcut: "Control+Alt+Shift+F11",
    }),
  );
  const app = await _electron.launch({
    args: [resolve("apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".topbar")).toBeVisible();
    if (process.platform === "win32") {
      expect(
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu()),
      ).toBeNull();
      await page.keyboard.press("Alt");
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isMenuBarVisible(),
        ),
      ).toBe(false);
      expect(
        await page.evaluate(() =>
          Boolean(
            (
              navigator as Navigator & {
                windowControlsOverlay?: { visible: boolean };
              }
            ).windowControlsOverlay?.visible,
          ),
        ),
      ).toBe(false);
      await page.getByRole("button", { name: "最大化", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "还原窗口", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "还原窗口", exact: true }).click();
    } else {
      await expect(page.locator(".app")).toHaveAttribute(
        "data-platform",
        "darwin",
      );
      const gap = await page
        .locator(".version")
        .evaluate((el) => innerWidth - el.getBoundingClientRect().right);
      expect(gap).toBeLessThan(100);
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.maximize(),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isMaximized(),
        ),
      )
      .toBe(true);
    if (process.platform === "win32")
      await expect(
        page.getByRole("button", { name: "还原窗口", exact: true }),
      ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.unmaximize(),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isMaximized(),
        ),
      )
      .toBe(false);
    if (process.platform === "win32")
      await page.getByRole("button", { name: "最小化", exact: true }).click();
    else
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.minimize(),
      );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isMinimized(),
        ),
      )
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.restore();
      win.show();
    });
    if (process.platform === "win32")
      await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    else
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.close(),
      );
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        return { destroyed: win.isDestroyed(), visible: win.isVisible() };
      }),
    ).toEqual({ destroyed: false, visible: false });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
