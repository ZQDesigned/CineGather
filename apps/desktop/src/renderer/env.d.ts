import type { DesktopBridge } from "@cinegather/contracts";
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
