import { expect, test } from "bun:test";
import { defaultSettings, settingsSchema } from "../src/shared/settings";
test("legacy microphone settings default to original voice and keep the explicit KTV choice", () => {
  const legacy = { ...defaultSettings } as Record<string, unknown>;
  delete legacy.microphoneEffect;
  expect(settingsSchema.parse(legacy)).toHaveProperty(
    "microphoneEffect",
    "none",
  );
  expect(
    settingsSchema.parse({ ...defaultSettings, microphoneEffect: "ktv" }),
  ).toHaveProperty("microphoneEffect", "ktv");
  expect(
    settingsSchema.safeParse({
      ...defaultSettings,
      microphoneEffect: "invalid",
    }).success,
  ).toBe(false);
});
