import { expect, test } from "bun:test";
import {
  defaultSettings,
  restoreSettings,
  settingsSchema,
} from "../src/shared/settings";

test("new and missing noise settings use basic reduction without losing devices or shortcuts", () => {
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
    noiseReduction: "basic",
  });
  expect(defaultSettings).toHaveProperty("noiseReduction", "basic");
});

test("the next upgrade switches legacy enhanced reduction to basic once and retains other preferences", () => {
  for (const revision of [undefined, 0]) {
    const legacy = {
      ...defaultSettings,
      noiseReductionRevision: revision,
      noiseReduction: "enhanced",
      inputDevice: "saved-usb-mic",
      outputDevice: "saved-headphones",
      microphoneInputVolume: 73,
      microphoneEffect: "ktv" as const,
      notifications: { ...defaultSettings.notifications, volume: 27 },
    };
    const result = restoreSettings(JSON.parse(JSON.stringify(legacy)));
    expect(result.migrated).toBe(true);
    expect(result.settings).toEqual({
      ...legacy,
      noiseReduction: "basic",
      noiseReductionRevision: 1,
      noiseReductionNoticePending: true,
    });
  }
});

test("the noise migration preserves existing basic and disabled choices", () => {
  for (const noiseReduction of ["basic", "off"] as const) {
    const result = restoreSettings({
      ...defaultSettings,
      noiseReductionRevision: 0,
      noiseReduction,
    });
    expect(result.migrated).toBe(true);
    expect(result.settings.noiseReduction).toBe(noiseReduction);
    expect(result.settings).toHaveProperty("noiseReductionRevision", 1);
    expect(result.settings).toHaveProperty(
      "noiseReductionNoticePending",
      false,
    );
  }
});

test("explicit choices after migration, including enhanced, survive subsequent launches", () => {
  const first = restoreSettings({
    ...defaultSettings,
    noiseReductionRevision: 0,
    noiseReduction: "enhanced",
  });
  for (const noiseReduction of ["basic", "off", "enhanced"] as const) {
    const saved = { ...first.settings, noiseReduction };
    expect(restoreSettings(JSON.parse(JSON.stringify(saved)))).toEqual({
      settings: saved,
      migrated: false,
    });
  }
});

test("a future noise revision is preserved without replaying an old reset", () => {
  const result = restoreSettings({
    ...defaultSettings,
    noiseReductionRevision: 2,
    noiseReduction: "enhanced",
  });
  expect(result.migrated).toBe(false);
  expect(result.settings.noiseReduction).toBe("enhanced");
  expect(result.settings).toHaveProperty("noiseReductionRevision", 2);
});

test("only migrated enhanced users get a notice, and acknowledging it survives restarts", () => {
  expect(defaultSettings).toHaveProperty("noiseReductionNoticePending", false);
  const upgraded = restoreSettings({
    ...defaultSettings,
    noiseReductionRevision: 0,
    noiseReduction: "enhanced",
  });
  expect(upgraded.settings).toHaveProperty("noiseReductionNoticePending", true);
  expect(restoreSettings(upgraded.settings).settings).toHaveProperty(
    "noiseReductionNoticePending",
    true,
  );
  const acknowledged = {
    ...upgraded.settings,
    noiseReductionNoticePending: false,
  };
  expect(restoreSettings(JSON.parse(JSON.stringify(acknowledged)))).toEqual({
    settings: acknowledged,
    migrated: false,
  });
});

test("notification and noise migrations can run together without losing unrelated choices", () => {
  const legacy: Record<string, unknown> = {
    ...defaultSettings,
    noiseReduction: "enhanced",
    notifications: {
      ...defaultSettings.notifications,
      volume: 23,
      sound: false,
    },
  };
  delete legacy.notificationVolumeRevision;
  delete legacy.noiseReductionRevision;
  const result = restoreSettings(legacy);
  expect(result.migrated).toBe(true);
  expect(result.settings.noiseReduction).toBe("basic");
  expect(result.settings.notifications.volume).toBe(100);
  expect(result.settings.notifications.sound).toBe(false);
  expect(restoreSettings(result.settings)).toEqual({
    settings: result.settings,
    migrated: false,
  });
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
