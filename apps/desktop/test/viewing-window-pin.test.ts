import { expect, test } from "bun:test";
import { setViewingWindowPinned } from "../src/main/viewing-window-policy";

test("Windows viewing pin uses a topmost level above the shell and returns actual state", () => {
  const calls: unknown[] = [];
  let pinned = false;
  const window = {
    setAlwaysOnTop(value: boolean, level?: string) {
      calls.push([value, level]);
      pinned = value;
    },
    isAlwaysOnTop: () => pinned,
    moveTop: () => calls.push("raise"),
  };
  expect(setViewingWindowPinned(window, true, "win32")).toBe(true);
  expect(calls).toEqual([[true, "screen-saver"], "raise"]);
  calls.length = 0;
  expect(setViewingWindowPinned(window, false, "win32")).toBe(false);
  expect(calls).toEqual([[false, "screen-saver"]]);
});

test("Mac viewing pin retains floating level without raising an unpinned window", () => {
  const calls: unknown[] = [];
  const window = {
    setAlwaysOnTop: (value: boolean, level?: string) =>
      calls.push([value, level]),
    isAlwaysOnTop: () => true,
    moveTop: () => calls.push("raise"),
  };
  expect(setViewingWindowPinned(window, true, "darwin")).toBe(true);
  expect(calls).toEqual([[true, "floating"], "raise"]);
});
