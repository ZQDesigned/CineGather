import { test, expect } from "bun:test";
import {
  defaultServer,
  readWebInvitation,
  platformSettings,
} from "../src/renderer/platform";
import { defaultSettings } from "../src/shared/settings";
import { matchesShortcut } from "../src/shared/shortcuts";
import { parseInvitation } from "@cinegather/client-core";

test("browser settings discard legacy push-to-talk while desktop settings remain intact", () => {
  const saved = {
    ...defaultSettings,
    pushToTalk: true,
    quality: "game" as const,
    muteShortcut: "Control+Shift+K",
  };
  expect(platformSettings(saved, false)).toEqual({
    ...saved,
    pushToTalk: false,
  });
  expect(platformSettings(saved, true)).toEqual(saved);
  expect(saved.pushToTalk).toBe(true);
});

test("web defaults to its own origin while native keeps the local API and configured addresses win", () => {
  expect(defaultServer(undefined, "", "https://watch.example.com", false)).toBe(
    "https://watch.example.com",
  );
  expect(defaultServer(undefined, undefined, "app://cinegather", true)).toBe(
    "http://127.0.0.1:14310",
  );
  expect(
    defaultServer(
      "https://custom.example.com",
      "https://configured.example.com",
      "https://watch.example.com",
      false,
    ),
  ).toBe("https://custom.example.com");
});

test("web invitation tokens use fragments, parse on either platform, and are removed from the address bar", () => {
  const link =
    "https://watch.example.com/?room=ABCDEF12#invite=" + "a".repeat(43);
  expect(parseInvitation(link)).toEqual({
    roomId: "ABCDEF12",
    inviteToken: "a".repeat(43),
  });
  let scrubbed = "";
  expect(
    readWebInvitation(link, (clean) => {
      scrubbed = clean;
    }),
  ).toBe(link);
  expect(scrubbed).toBe("https://watch.example.com/");
  expect(
    parseInvitation("cinegather://join?room=ABCDEF12&invite=" + "a".repeat(43))
      .inviteToken,
  ).toBe("a".repeat(43));
  expect(
    readWebInvitation("https://watch.example.com/", () => {}),
  ).toBeUndefined();
});

test("browser shortcuts match physical keys with exact platform modifiers without firing on repeats or composition", () => {
  const input = { code: "KeyM", meta: true, shift: true };
  expect(matchesShortcut("CommandOrControl+Shift+M", input, "darwin")).toBe(
    true,
  );
  expect(matchesShortcut("CommandOrControl+Shift+M", input, "win32")).toBe(
    false,
  );
  expect(
    matchesShortcut(
      "CommandOrControl+Shift+M",
      { ...input, alt: true },
      "darwin",
    ),
  ).toBe(false);
  expect(
    matchesShortcut(
      "CommandOrControl+Shift+M",
      { ...input, isAutoRepeat: true },
      "darwin",
    ),
  ).toBe(false);
  expect(
    matchesShortcut(
      "CommandOrControl+Shift+M",
      { ...input, isComposing: true },
      "darwin",
    ),
  ).toBe(false);
});
