import type { CaptureSelection } from "@cinegather/contracts";
export interface NativeWindow {
  windowId: number;
  pid: number;
  title: string;
  application: string;
  bundleId: string;
}
export interface NativeDisplay {
  displayId: number;
  name: string;
}
export function selectNativeSource(
  selection: CaptureSelection,
  windows: NativeWindow[],
  displays: NativeDisplay[],
  excludedApplication?: string,
) {
  windows = windows.filter(
    (window) =>
      !window.bundleId.startsWith("city.zqdesigned.cinegather") &&
      window.bundleId !== excludedApplication,
  );
  const window = windows.find(
    (w) => `native:${w.windowId}:${w.pid}` === selection.sourceId,
  );
  const display = displays.find(
    (d) => `native-screen:${d.displayId}` === selection.sourceId,
  );
  if (!window && !display) throw new Error("共享来源已关闭，请重新选择");
  const application = window?.bundleId;
  return {
    window,
    displayId: display?.displayId,
    application,
    systemAudio: selection.systemAudio,
    expiresAt: Date.now() + 20_000,
  };
}
