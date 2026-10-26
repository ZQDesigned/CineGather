import { expect, test } from "bun:test";
import {
  mainWindowChrome,
  configureMainWindowMenu,
  controlMainWindow,
  mainWindowState,
} from "../src/main/window-chrome";
test("Windows uses a frameless window without a native caption overlay", () => {
  expect(mainWindowChrome("win32")).toEqual({
    titleBarStyle: "hidden",
    frame: false,
    titleBarOverlay: false,
  });
});
test("Mac keeps inset traffic lights and other platforms retain their frame", () => {
  expect(mainWindowChrome("darwin")).toEqual({ titleBarStyle: "hiddenInset" });
  expect(mainWindowChrome("linux")).toEqual({ titleBarStyle: "default" });
});
test("Windows removes menus rather than allowing Alt to reveal an auto-hidden one", () => {
  const calls: string[] = [];
  const menu = {
    setApplicationMenu: (value: null) => {
      expect(value).toBeNull();
      calls.push("application");
    },
  };
  const win = { removeMenu: () => calls.push("window") };
  configureMainWindowMenu("win32", menu, win);
  expect(calls).toEqual(["application", "window"]);
  calls.length = 0;
  configureMainWindowMenu("darwin", menu, win);
  expect(calls).toEqual([]);
});

test("frontend commands use current OS maximize state and close through the existing window lifecycle", () => {
  const calls: string[] = [];
  let maximized = false;
  const window = {
    isDestroyed: () => false,
    isMaximized: () => maximized,
    maximize: () => {
      maximized = true;
      calls.push("maximize");
    },
    unmaximize: () => {
      maximized = false;
      calls.push("unmaximize");
    },
    minimize: () => {
      calls.push("minimize");
    },
    close: () => {
      calls.push("close");
    },
  };
  controlMainWindow(window, "toggle-maximize");
  expect(mainWindowState(window)).toEqual({ maximized: true });
  controlMainWindow(window, "toggle-maximize");
  expect(mainWindowState(window)).toEqual({ maximized: false });
  maximized = true; // A snap or title-bar double-click can change state outside React.
  controlMainWindow(window, "toggle-maximize");
  controlMainWindow(window, "minimize");
  controlMainWindow(window, "close");
  expect(calls).toEqual([
    "maximize",
    "unmaximize",
    "unmaximize",
    "minimize",
    "close",
  ]);
  for (const input of ["quit", "destroy", null, { action: "close" }])
    expect(() => controlMainWindow(window, input)).toThrow();
  expect(calls).toHaveLength(5);
  const destroyed = { ...window, isDestroyed: () => true };
  controlMainWindow(destroyed, "toggle-maximize");
  controlMainWindow(destroyed, "close");
  expect(mainWindowState(destroyed)).toEqual({ maximized: false });
  expect(calls).toHaveLength(5);
});
