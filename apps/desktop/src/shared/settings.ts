import { z } from "zod";
import {
  nativeEncoderIdSchema,
  notificationPreferencesSchema,
  defaultNotificationPreferences,
  watchProfileSchema,
  defaultMicrophoneReverbStrength,
  type DesktopSettings,
  type MemberOverlayPreferences,
} from "@cinegather/contracts";
export const defaultOverlayPreferences: MemberOverlayPreferences = {
  enabled: true,
  opacity: 85,
  position: "right-top",
};
export const settingsSchema = z.strictObject({
  notificationVolumeRevision: z.number().int().min(0).default(0),
  noiseReductionRevision: z.number().int().min(0).default(0),
  noiseReductionNoticePending: z.boolean().default(false),
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
  microphoneInputVolume: z.number().int().min(0).max(200).default(100),
  microphoneMonitorVolume: z.number().int().min(0).max(100).default(30),
  microphoneReverbStrength: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(defaultMicrophoneReverbStrength),
  noiseReduction: z.enum(["enhanced", "basic", "off"]).default("basic"),
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
  noiseReductionRevision: 1,
  noiseReductionNoticePending: false,
  watchProfile: "balanced" as const,
  notifications: defaultNotificationPreferences,
  roomSounds: true,
  windowsEncoder: "auto",
  autoDownloadUpdates: true,
  noiseReduction: "basic",
  microphoneEffect: "none",
  microphoneMonitorVolume: 30,
  microphoneInputVolume: 100,
  microphoneReverbStrength: defaultMicrophoneReverbStrength,
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
  let settings = settingsSchema.parse(input);
  let migrated = false;
  if (settings.notificationVolumeRevision < 1) {
    settings = {
      ...settings,
      notificationVolumeRevision: 1,
      notifications: { ...settings.notifications, volume: 100 },
    };
    migrated = true;
  }
  if (settings.noiseReductionRevision < 1) {
    const adjusted = settings.noiseReduction === "enhanced";
    settings = {
      ...settings,
      noiseReductionRevision: 1,
      noiseReduction: adjusted ? "basic" : settings.noiseReduction,
      noiseReductionNoticePending: adjusted,
    };
    migrated = true;
  }
  return { settings, migrated };
}
