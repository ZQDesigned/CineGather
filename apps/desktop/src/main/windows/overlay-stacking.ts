import type { BrowserWindow } from "electron";

type OverlayWindow = Pick<
  BrowserWindow,
  "setAlwaysOnTop" | "moveTop" | "isVisible" | "isDestroyed"
>;

export class OverlayStacking {
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  constructor(
    private window: OverlayWindow,
    private platform: NodeJS.Platform,
    private raiseNative?: () => void,
  ) {
    // On Windows "floating" explicitly positions behind Shell_TrayWnd, which
    // can also demote the native HWND when the shell is not itself topmost.
    window.setAlwaysOnTop(
      true,
      platform === "win32" ? "screen-saver" : "floating",
    );
  }
  private repair = () => {
    if (
      this.disposed ||
      this.window.isDestroyed() ||
      !this.window.isVisible()
    ) {
      this.visible(false);
      return;
    }
    if (this.raiseNative) {
      try {
        this.raiseNative();
        return;
      } catch {
        this.raiseNative = undefined;
        console.warn("overlay-topmost-native-unavailable");
      }
    }
    // Retain a non-activating fallback if the native binding is unavailable.
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.moveTop();
  };
  visible(visible: boolean) {
    if (
      !visible ||
      this.disposed ||
      this.window.isDestroyed() ||
      !this.window.isVisible()
    ) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    if (this.platform !== "win32" || this.timer) return;
    this.repair();
    this.timer = setInterval(this.repair, 1000);
    this.timer.unref();
  }
  destroy() {
    this.disposed = true;
    this.visible(false);
  }
}
