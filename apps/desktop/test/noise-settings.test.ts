import { expect, test } from "bun:test";
import { defaultSettings, settingsSchema } from "../src/shared/settings";

test("legacy settings acquire enhanced noise reduction without losing devices or shortcuts", () => {
  const legacy = {
    ...defaultSettings,
    inputDevice: "usb-mic",
    outputDevice: "headset",
    pushToTalk: true,
    muteShortcut: "Control+Alt+K",
  };
  delete (legacy as Record<string, unknown>).noiseReduction;
  expect(settingsSchema.parse(legacy)).toEqual({
    ...legacy,
    noiseReduction: "enhanced",
  });
  expect(defaultSettings).toHaveProperty("noiseReduction", "enhanced");
});

test("explicit basic and disabled noise reduction survive saving while unsupported modes are rejected", () => {
  for (const noiseReduction of ["enhanced", "basic", "off"])
    expect(
      settingsSchema.parse({ ...defaultSettings, noiseReduction }),
    ).toHaveProperty("noiseReduction", noiseReduction);
  expect(
    settingsSchema.safeParse({ ...defaultSettings, noiseReduction: "invalid" })
      .success,
  ).toBe(false);
});
