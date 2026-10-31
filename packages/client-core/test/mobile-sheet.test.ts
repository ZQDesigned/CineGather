import { expect, test } from "bun:test";
import { mobileSheetLayout } from "../src/mobile-sheet";
test("unpatched Android binaries use a full-height JS footer and reserve the keyboard", () => {
  for (const build of [0, 1, 2, 3, NaN]) {
    const layout = mobileSheetLayout("android", build);
    expect(layout.nativeFooter).toBe(false);
    expect(layout.detents).toEqual([1]);
    expect(layout.reserveKeyboard).toBe(true);
  }
});
test("patched Android and iOS keep their existing native sheet presentations", () => {
  expect(mobileSheetLayout("android", 4)).toEqual({
    nativeFooter: true,
    detents: [0.6, 1],
    reserveKeyboard: false,
  });
  expect(mobileSheetLayout("ios", 3)).toEqual({
    nativeFooter: false,
    detents: [0.6, 1],
    reserveKeyboard: true,
  });
});
