import { createRequire } from "node:module";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import {
  intersectRectangles,
  uncoveredRectangles,
  type VisibilityWindow,
  type WindowRectangle,
} from "./watch-visibility";
type NativeWindow = VisibilityWindow &
  Pick<BrowserWindow, "getNativeWindowHandle">;
function handle(window: VisibilityWindow) {
  const bytes = (window as NativeWindow).getNativeWindowHandle();
  return bytes.length === 8
    ? bytes.readBigUInt64LE()
    : BigInt(bytes.readUInt32LE());
}
function readRect(bytes: Buffer): WindowRectangle {
  return {
    left: bytes.readInt32LE(0),
    top: bytes.readInt32LE(4),
    right: bytes.readInt32LE(8),
    bottom: bytes.readInt32LE(12),
  };
}
function rectBuffer(rect: WindowRectangle) {
  const b = Buffer.alloc(16);
  [rect.left, rect.top, rect.right, rect.bottom].forEach((v, i) =>
    b.writeInt32LE(v, i * 4),
  );
  return b;
}
export function nativeWindowVisibility(
  platform: NodeJS.Platform,
  resourcesPath?: string,
) {
  if (platform !== "win32" && platform !== "darwin")
    return { visible: () => true, dispose: () => {} };
  try {
    const load = createRequire(__filename);
    const ffi = load(
      resourcesPath
        ? join(resourcesPath, "native/node_modules/koffi/index.cjs")
        : "koffi",
    ) as typeof import("koffi");
    if (platform === "darwin") {
      const objc = ffi.load("/usr/lib/libobjc.A.dylib");
      const selector = objc.func(
        "uintptr_t sel_registerName(const char *name)",
      );
      const send = objc.func(
        "uintptr_t objc_msgSend(uintptr_t object, uintptr_t selector)",
      );
      const windowSelector = selector("window"),
        occlusionSelector = selector("occlusionState");
      return {
        visible: (window: VisibilityWindow) => {
          const native = send(handle(window), windowSelector);
          // NSWindowOcclusionStateVisible means at least some window area is visible.
          return (
            !native || Boolean(BigInt(send(native, occlusionSelector)) & 2n)
          );
        },
        dispose: () => {},
      };
    }
    const user = ffi.load("user32.dll"),
      dwm = ffi.load("dwmapi.dll"),
      gdi = ffi.load("gdi32.dll");
    const top = user.func("uintptr_t __stdcall GetTopWindow(uintptr_t parent)");
    const next = user.func(
      "uintptr_t __stdcall GetWindow(uintptr_t window,uint32_t command)",
    );
    const shown = user.func("int __stdcall IsWindowVisible(uintptr_t window)");
    const iconic = user.func("int __stdcall IsIconic(uintptr_t window)");
    const getRect = user.func(
      "int __stdcall GetWindowRect(uintptr_t window,void *rectangle)",
    );
    const attribute = dwm.func(
      "int32_t __stdcall DwmGetWindowAttribute(uintptr_t window,uint32_t attribute,void *value,uint32_t size)",
    );
    const style = user.func(
      "intptr_t __stdcall GetWindowLongPtrW(uintptr_t window,int index)",
    );
    const layered = user.func(
      "int __stdcall GetLayeredWindowAttributes(uintptr_t window,void *key,void *alpha,void *flags)",
    );
    const getRegion = user.func(
      "int __stdcall GetWindowRgn(uintptr_t window,uintptr_t region)",
    );
    const createRegion = gdi.func(
      "uintptr_t __stdcall CreateRectRgn(int left,int top,int right,int bottom)",
    );
    const regionBox = gdi.func(
      "int __stdcall GetRgnBox(uintptr_t region,void *rectangle)",
    );
    const removeRegion = gdi.func(
      "int __stdcall DeleteObject(uintptr_t object)",
    );
    const monitor = user.func(
      "uintptr_t __stdcall MonitorFromRect(void *rectangle,uint32_t flags)",
    );
    const metric = user.func("int __stdcall GetSystemMetrics(int index)");
    const region = createRegion(0, 0, 0, 0);
    if (!region) throw Error("Visibility region unavailable");
    const cloaked = (hwnd: bigint) => {
      const b = Buffer.alloc(4);
      return attribute(hwnd, 14, b, 4) === 0
        ? Boolean(b.readUInt32LE())
        : undefined;
    };
    const bounds = (hwnd: bigint) => {
      const b = Buffer.alloc(16);
      if (attribute(hwnd, 9, b, 16) !== 0 && !getRect(hwnd, b)) return;
      const r = readRect(b);
      return r.right > r.left && r.bottom > r.top ? r : undefined;
    };
    const opaqueBounds = (hwnd: bigint) => {
      if (!shown(hwnd) || iconic(hwnd) || cloaked(hwnd) !== false) return;
      const flags = Number(style(hwnd, -20));
      if (flags & 0x80000) {
        const alpha = Buffer.alloc(1),
          layerFlags = Buffer.alloc(4);
        if (!layered(hwnd, null, alpha, layerFlags)) return;
        const f = layerFlags.readUInt32LE();
        if (f & 1 || !(f & 2) || alpha[0] !== 255) return;
      }
      const rect = bounds(hwnd);
      if (!rect) return;
      const kind = getRegion(hwnd, region);
      if (kind === 1 || kind === 3) return; // Empty or non-rectangular windows are not proven opaque.
      if (kind === 2) {
        const box = Buffer.alloc(16),
          origin = Buffer.alloc(16);
        if (!regionBox(region, box) || !getRect(hwnd, origin)) return;
        const r = readRect(box),
          o = readRect(origin);
        return intersectRectangles(rect, {
          left: r.left + o.left,
          top: r.top + o.top,
          right: r.right + o.left,
          bottom: r.bottom + o.top,
        });
      }
      return rect;
    };
    return {
      visible: (window: VisibilityWindow) => {
        const hwnd = handle(window);
        if (!shown(hwnd) || iconic(hwnd) || cloaked(hwnd)) return false;
        const target = bounds(hwnd);
        if (!target) return true;
        const left = metric(76),
          topEdge = metric(77),
          width = metric(78),
          height = metric(79);
        if (width <= 0 || height <= 0) return true;
        const onscreen = intersectRectangles(target, {
          left,
          top: topEdge,
          right: left + width,
          bottom: topEdge + height,
        });
        if (!onscreen) return false;
        let exposed = [onscreen];
        for (
          let current = BigInt(top(0)), count = 0;
          current && count < 512;
          current = BigInt(next(current, 2)), count++
        ) {
          if (current === hwnd)
            return exposed.some((rect) =>
              Boolean(monitor(rectBuffer(rect), 0)),
            );
          const cover = opaqueBounds(current);
          if (cover) {
            exposed = exposed.flatMap((rect) =>
              uncoveredRectangles(rect, [cover]),
            );
            if (!exposed.length) return false;
            if (exposed.length > 128) return true;
          }
        }
        return true; // A changing native z-order is not proof of full occlusion.
      },
      dispose: () => {
        removeRegion(region);
      },
    };
  } catch {
    console.warn("watch-window-occlusion-unavailable");
    return { visible: () => true, dispose: () => {} };
  }
}
