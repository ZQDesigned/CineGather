import { expect, test } from "bun:test";
import {
  mainWindowChrome,
  configureMainWindowMenu,
} from "../src/main/window-chrome";
test("Windows integrates native caption buttons into the 56px app title bar", () => {
  expect(mainWindowChrome("win32")).toEqual({
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0d0f14", symbolColor: "#d5d7e2", height: 56 },
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
