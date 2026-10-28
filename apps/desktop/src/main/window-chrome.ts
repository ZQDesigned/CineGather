import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { z } from "zod";
import type { MainWindowState } from "@cinegather/contracts";

// Match NSIS shortcut metadata. Never include the executable path or version:
// Windows must recognize pinned shortcuts and running windows as the same app.
export const windowsAppId = "city.zqdesigned.cinegather";
export function configureWindowsAppIdentity(
  platform: string,
  application: { setAppUserModelId(id: string): void },
) {
  if (platform === "win32") application.setAppUserModelId(windowsAppId);
}

export function mainWindowChrome(
  platform: string,
): Pick<
  BrowserWindowConstructorOptions,
  "frame" | "titleBarStyle" | "titleBarOverlay"
> {
  if (platform === "win32")
    return {
      titleBarStyle: "hidden",
      frame: false,
      titleBarOverlay: false,
    };
  return { titleBarStyle: platform === "darwin" ? "hiddenInset" : "default" };
}

export function configureMainWindowMenu(
  platform: string,
  menu: { setApplicationMenu(menu: null): void },
  window: { removeMenu(): void },
) {
  if (platform !== "win32") return;
  menu.setApplicationMenu(null);
  window.removeMenu();
}

type ControlledWindow = Pick<
  BrowserWindow,
  | "isDestroyed"
  | "isMaximized"
  | "minimize"
  | "maximize"
  | "unmaximize"
  | "close"
>;
export function mainWindowState(window: ControlledWindow): MainWindowState {
  return { maximized: !window.isDestroyed() && window.isMaximized() };
}
const windowAction = z.enum(["minimize", "toggle-maximize", "close"]);
export function controlMainWindow(
  window: ControlledWindow,
  input: unknown,
): void {
  const action = windowAction.parse(input);
  if (window.isDestroyed()) return;
  if (action === "minimize") window.minimize();
  else if (action === "close") window.close();
  else if (window.isMaximized()) window.unmaximize();
  else window.maximize();
}
