import { test, expect } from "bun:test";
import { recordedShortcut, displayShortcut } from "../src/shared/shortcuts";

test("key capture uses physical keys with modifiers and ignores composition, repeats and unsupported chords", () => {
  expect(recordedShortcut({ code: "KeyK", control: true, alt: true })).toBe(
    "Control+Alt+K",
  );
  expect(recordedShortcut({ code: "Space", meta: true, shift: true })).toBe(
    "Command+Shift+Space",
  );
  for (const input of [
    { code: "KeyK" },
    { code: "ShiftLeft", shift: true },
    { code: "KeyK", control: true, isComposing: true },
    { code: "KeyK", control: true, isAutoRepeat: true },
    { code: "AudioVolumeUp", meta: true },
  ]) {
    expect(recordedShortcut(input)).toBeUndefined();
  }
  expect(displayShortcut("CommandOrControl+Shift+Space", "darwin")).toBe(
    "⌘ + ⇧ + 空格",
  );
  expect(displayShortcut("Control+Alt+K", "win32")).toBe("Ctrl + Alt + K");
});
