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

test("web uses its own origin and an unconfigured desktop release defaults to the public API", () => {
  expect(defaultServer(undefined, "", "https://watch.example.com", false)).toBe(
    "https://watch.example.com",
  );
  expect(defaultServer(undefined, undefined, "app://cinegather", true)).toBe(
    "https://cgplat.zqdesigned.city",
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
    parseInvitation("cinegather://join?room=ABCDEF12&invite=" + "a".repeat(43)),
  ).toEqual({ roomId: "" });
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

test("explicit local self-hosting and development API addresses are preserved", () => {
  expect(
    defaultServer(
      "http://127.0.0.1:14310",
      undefined,
      "app://cinegather",
      true,
    ),
  ).toBe("http://127.0.0.1:14310");
  expect(
    defaultServer(
      undefined,
      "http://127.0.0.1:14310",
      "app://cinegather",
      true,
    ),
  ).toBe("http://127.0.0.1:14310");
  expect(defaultServer("invalid", undefined, "app://cinegather", true)).toBe(
    "https://cgplat.zqdesigned.city",
  );
});
test("web invitation is scrubbed synchronously before lazy UI and handed off exactly once", async () => {
  const { captureWebInvitation, takeCapturedWebInvitation } = await import(
    "../src/renderer/features/rooms/web-invitation"
  );
  const href =
    "https://watch.example.com/?room=ABCDEF12#invite=" + "b".repeat(43);
  let address = href;
  captureWebInvitation(href, (clean) => (address = clean));
  expect(address).toBe("https://watch.example.com/");
  expect(takeCapturedWebInvitation()).toBe(href);
  expect(takeCapturedWebInvitation()).toBeUndefined();
});
