import type { BrowserWindow } from "electron";

export function setViewingWindowPinned(
  window: Pick<BrowserWindow, "setAlwaysOnTop" | "isAlwaysOnTop" | "moveTop">,
  pinned: boolean,
  platform: NodeJS.Platform,
) {
  // Windows places "floating" below the taskbar, which can demote the HWND
  // despite Electron continuing to report isAlwaysOnTop() as true.
  window.setAlwaysOnTop(
    pinned,
    platform === "win32" ? "screen-saver" : "floating",
  );
  if (pinned) window.moveTop();
  return window.isAlwaysOnTop();
}

export function allowedViewingWindow(
  raw: string,
  frameName: string,
  mainURL: string,
) {
  try {
    const url = new URL(raw),
      main = new URL(mainURL),
      expected = new URL("watch.html", main);
    return (
      frameName === "cinegather-watch" &&
      ["app:", "http:", "https:"].includes(main.protocol) &&
      url.href === expected.href &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
