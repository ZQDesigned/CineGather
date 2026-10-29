import { expect, test } from "bun:test";
import {
  defaultSettings,
  restoreSettings,
  settingsSchema,
} from "../src/shared/settings";
import { defaultNotificationPreferences } from "@cinegather/contracts";

test("notification volume defaults to 100 for new settings", () => {
  expect(defaultNotificationPreferences.volume).toBe(100);
  expect(defaultSettings.notifications.volume).toBe(100);
});

test("older settings reset notification volume once without enabling muted or disabled notifications", () => {
  for (const volume of [0, 30, 100]) {
    const notifications = {
      ...defaultNotificationPreferences,
      volume,
      enabled: false,
      sound: false,
      doNotDisturb: true,
      preview: false,
      chat: false,
    };
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      inputDevice: "saved-microphone",
      outputDevice: "saved-headphones",
      notifications,
    };
    delete legacy.notificationVolumeRevision;
    const restored = restoreSettings(legacy);
    expect(restored.migrated).toBe(true);
    expect(restored.settings.notifications).toEqual({
      ...notifications,
      volume: 100,
    });
    expect(restored.settings.inputDevice).toBe("saved-microphone");
    expect(restored.settings.outputDevice).toBe("saved-headphones");
  }
});

test("saved choices after the reset survive subsequent launches, including zero volume", () => {
  const legacy: Record<string, unknown> = { ...defaultSettings };
  delete legacy.notificationVolumeRevision;
  const first = restoreSettings(legacy);
  for (const volume of [0, 23, 100]) {
    const saved = settingsSchema.parse({
      ...first.settings,
      notifications: { ...first.settings.notifications, volume },
    });
    const again = restoreSettings(JSON.parse(JSON.stringify(saved)));
    expect(again.migrated).toBe(false);
    expect(again.settings.notifications.volume).toBe(volume);
  }
});

test("a newer settings revision does not rerun an older notification reset", () => {
  const next = restoreSettings({
    ...defaultSettings,
    notificationVolumeRevision: 2,
    notifications: { ...defaultNotificationPreferences, volume: 17 },
  });
  expect(next.migrated).toBe(false);
  expect(next.settings.notifications.volume).toBe(17);
});
