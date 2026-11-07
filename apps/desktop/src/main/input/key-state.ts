import { createRequire } from "node:module";
import { join } from "node:path";

// Called only in Electron Main for hold-to-talk or explicit shortcut recording. The bridge
// never exposes native calls, key codes or keyboard events to the renderer.
export function nativeKeyState(
  platform: NodeJS.Platform,
  resourcesPath?: string,
) {
  const load = createRequire(__filename);
  const ffi = load(
    resourcesPath
      ? join(resourcesPath, "native/node_modules/koffi/index.cjs")
      : "koffi",
  ) as typeof import("koffi");
  if (platform === "darwin") {
    const query = ffi
      .load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
      .func("bool CGEventSourceKeyState(int state, uint16_t key)");
    return (key: number) => Boolean(query(0, key));
  }
  if (platform === "win32") {
    const query = ffi
      .load("user32.dll")
      .func("short __stdcall GetAsyncKeyState(int key)");
    return (key: number) => Boolean(Number(query(key)) & 0x8000);
  }
  throw new Error("当前系统不支持全局按住说话");
}
