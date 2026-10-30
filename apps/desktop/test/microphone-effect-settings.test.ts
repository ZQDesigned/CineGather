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

test("ear monitor only persists its bounded volume, never an enabled capture state", () => {
  const legacy = { ...defaultSettings } as Record<string, unknown>;
  delete legacy.microphoneMonitorVolume;
  expect(settingsSchema.parse(legacy)).toHaveProperty(
    "microphoneMonitorVolume",
    30,
  );
  for (const value of [0, 100])
    expect(
      settingsSchema.parse({
        ...defaultSettings,
        microphoneMonitorVolume: value,
      }),
    ).toHaveProperty("microphoneMonitorVolume", value);
  expect(
    settingsSchema.safeParse({
      ...defaultSettings,
      microphoneMonitorVolume: 101,
    }).success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({
      ...defaultSettings,
      microphoneMonitorEnabled: true,
    }).success,
  ).toBe(false);
});
