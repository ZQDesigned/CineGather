import { z } from "zod";
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
      opacity: z.number().int().min(30).max(100),
    })
    .default(defaultOverlayPreferences),
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
  noiseReduction: "enhanced",
  memberOverlay: defaultOverlayPreferences,
  minimizeToTray: true,
  pushToTalk: false,
  pttShortcut: "CommandOrControl+Shift+Space",
  muteShortcut: "CommandOrControl+Shift+M",
  quality: "cinema",
  inputDevice: "",
  outputDevice: "",
} satisfies DesktopSettings;
