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
    .toBe(true);
  for (const width of [980, 1360]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width, height: 760 }),
      width,
    );
    await expect
      .poll(() =>
        page
          .locator(".version")
          .evaluate((el) => innerWidth - el.getBoundingClientRect().right),
      )
      .toBeGreaterThanOrEqual(150);
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
    const w = BrowserWindow.getAllWindows()[0]!;
    w.restore();
    w.show();
    w.close();
  });
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
      captionOverlayVisible: true,
      reservedCaptionSpace: true,
      maximizeRestoreAndMinimize: true,
      closeToTray: true,
    }),
  );
  console.log(
    "Packaged Windows caption overlay and native window lifecycle verified",
  );
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
