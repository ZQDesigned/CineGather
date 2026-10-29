import { z } from "zod";
import {
  nativeEncoderIdSchema,
  notificationPreferencesSchema,
  defaultNotificationPreferences,
  watchProfileSchema,
} from "@cinegather/contracts";
import type {
  DesktopSettings,
  MemberOverlayPreferences,
} from "@cinegather/contracts";
export const defaultOverlayPreferences: MemberOverlayPreferences = {
  enabled: true,
  opacity: 85,
  position: "right-top",
};
export const settingsSchema = z.strictObject({
  notificationVolumeRevision: z.number().int().min(0).default(0),
  watchProfile: watchProfileSchema.default("balanced"),
  notifications: notificationPreferencesSchema.default(
    defaultNotificationPreferences,
  ),
  roomSounds: z.boolean().default(true),
  windowsEncoder: nativeEncoderIdSchema.default("auto"),
  autoDownloadUpdates: z.boolean().default(true),
  memberOverlay: z
    .strictObject({
      enabled: z.boolean(),
      position: z
        .enum([
          "left-top",
          "left-center",
          "left-bottom",
          "right-top",
          "right-center",
          "right-bottom",
        ])
        .default("right-top"),
      opacity: z.number().int().min(0).max(100),
    })
    .default(defaultOverlayPreferences),
  microphoneEffect: z.enum(["none", "ktv"]).default("none"),
  noiseReduction: z.enum(["enhanced", "basic", "off"]).default("enhanced"),
  minimizeToTray: z.boolean(),
  pushToTalk: z.boolean(),
  pttShortcut: z.string().min(1).max(64),
  muteShortcut: z.string().min(1).max(64),
  quality: z.enum(["saver", "cinema", "game"]),
  inputDevice: z.string().max(256),
  outputDevice: z.string().max(256),
});
export const defaultSettings = {
  notificationVolumeRevision: 1,
  watchProfile: "balanced" as const,
  notifications: defaultNotificationPreferences,
  roomSounds: true,
  windowsEncoder: "auto",
  autoDownloadUpdates: true,
  noiseReduction: "enhanced",
  microphoneEffect: "none",
  memberOverlay: defaultOverlayPreferences,
  minimizeToTray: true,
  pushToTalk: false,
  pttShortcut: "CommandOrControl+Shift+Space",
  muteShortcut: "CommandOrControl+Shift+M",
  quality: "cinema",
  inputDevice: "",
  outputDevice: "",
} satisfies DesktopSettings;

export function restoreSettings(input: unknown) {
  const settings = settingsSchema.parse(input);
  if (settings.notificationVolumeRevision >= 1)
    return { settings, migrated: false };
  return {
    settings: {
      ...settings,
      notificationVolumeRevision: 1,
      notifications: { ...settings.notifications, volume: 100 },
    },
    migrated: true,
  };
}
