import type { BrowserWindowConstructorOptions } from "electron";

export function mainWindowChrome(
  platform: string,
): Pick<BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  if (platform === "win32")
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#0d0f14", symbolColor: "#d5d7e2", height: 56 },
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
