import type { DesktopBridge, MemberOverlayBridge } from "@cinegather/contracts";
declare global {
  interface Window {
    desktop?: DesktopBridge;
    memberOverlay?: MemberOverlayBridge;
    notificationCard?: {
      state(): Promise<
        import("@cinegather/contracts").DesktopNotification | undefined
      >;
      close(): Promise<void>;
      activate(): Promise<void>;
      onChange(
        callback: (
          value?: import("@cinegather/contracts").DesktopNotification,
        ) => void,
      ): () => void;
    };
  }
}
