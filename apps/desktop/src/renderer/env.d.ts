import type { DesktopBridge, MemberOverlayBridge } from "@cinegather/contracts";
declare global {
  interface Window {
    desktop?: DesktopBridge;
    memberOverlay?: MemberOverlayBridge;
  }
}
