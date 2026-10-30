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

test("reverb strength defaults to the existing preset at 40 percent and accepts 0 through 100", () => {
  const legacy = { ...defaultSettings } as Record<string, unknown>;
  delete legacy.microphoneReverbStrength;
  expect(settingsSchema.parse(legacy)).toHaveProperty(
    "microphoneReverbStrength",
    40,
  );
  for (const value of [0, 40, 100])
    expect(
      settingsSchema.parse({
        ...defaultSettings,
        microphoneReverbStrength: value,
      }),
    ).toHaveProperty("microphoneReverbStrength", value);
  for (const value of [-1, 101, Number.NaN, 1.5])
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        microphoneReverbStrength: value,
      }).success,
    ).toBe(false);
});
