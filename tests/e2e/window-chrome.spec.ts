import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

test("Windows topbar reserves caption space at small sizes and in cinema; browser and Mac keep existing layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  for (const platform of ["win32", "darwin", "browser"]) {
    await page.evaluate(async (platform) => {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: platform === "browser" ? undefined : { platform },
      });
      const { update } = await import("/store.ts" as string);
      update({ cinema: false });
    }, platform);
    for (const width of [980, 1360]) {
      await page.setViewportSize({ width, height: 760 });
      const gap = await page
        .locator(".version")
        .evaluate((el) => innerWidth - el.getBoundingClientRect().right);
      expect(gap).toBeGreaterThanOrEqual(platform === "win32" ? 150 : 20);
      if (platform !== "win32") expect(gap).toBeLessThan(100);
    }
    await page.evaluate(async () => {
      const { update } = await import("/store.ts" as string);
      update({ cinema: true });
    });
    if (platform === "win32")
      await expect(page.locator(".topbar")).toBeVisible();
    else await expect(page.locator(".topbar")).toBeHidden();
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
      ).toBe(true);
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
      win.close();
    });
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
