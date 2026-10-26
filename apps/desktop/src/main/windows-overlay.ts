import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";

export function windowsOverlayRaise(
  window: Pick<BrowserWindow, "getNativeWindowHandle">,
  resourcesPath?: string,
) {
  const load = createRequire(__filename);
  const ffi = load(
    resourcesPath
      ? join(resourcesPath, "native/node_modules/koffi/index.cjs")
      : "koffi",
  ) as typeof import("koffi");
  const setPosition = ffi
    .load("user32.dll")
    .func(
      "int __stdcall SetWindowPos(intptr_t window, intptr_t after, int x, int y, int width, int height, uint32_t flags)",
    );
  // This handle comes only from our own BrowserWindow, never from renderer IPC.
  const handle = window.getNativeWindowHandle();
  const hwnd =
    handle.length === 8
      ? handle.readBigInt64LE()
      : BigInt(handle.readInt32LE());
  return () => {
    // HWND_TOPMOST; preserve bounds, foreground input and owner z-order. Do not
    // use SWP_SHOWWINDOW: a late repair must never resurrect a hidden overlay.
    if (!setPosition(hwnd, -1n, 0, 0, 0, 0, 0x0213))
      throw new Error("Windows overlay stacking failed");
  };
}
