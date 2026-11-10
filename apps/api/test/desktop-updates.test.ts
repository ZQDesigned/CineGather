import { test, expect } from "bun:test";
import {
  desktopEntryFeatures,
  desktopEntryRequired,
} from "../src/modules/updates/desktop-updates";
import type { DesktopPolicy } from "@cinegather/contracts";
const policy: DesktopPolicy = {
  format: 1,
  kind: "desktop-ui-policy",
  platform: "win32",
  arch: "x64",
  runtime: "a".repeat(64),
  sequence: 1,
  revision: 3,
  minimumRevision: 2,
  bundleId: "b".repeat(64),
  featureMinimums: { "room.activities": 3 },
  publishedAt: new Date().toISOString(),
  notes: "",
};
test("a forced UI floor blocks new sessions but preserves server-recognized membership and cleanup", () => {
  expect(desktopEntryRequired(policy, "1", ["room.standard"])).toBe(2);
  expect(
    desktopEntryRequired(policy, "1", ["room.standard"], true),
  ).toBeUndefined();
  expect(desktopEntryRequired(policy, "2", ["room.activities"])).toBe(3);
  expect(
    desktopEntryFeatures("POST", "/api/v1/rooms/id/leave"),
  ).toBeUndefined();
  expect(
    desktopEntryFeatures("POST", "/api/v1/games/id/renew"),
  ).toBeUndefined();
  expect(desktopEntryFeatures("POST", "/api/v1/games")).toEqual([
    "game.minecraft-java",
  ]);
  expect(
    desktopEntryFeatures("POST", "/api/v1/games/invitations/id/accept"),
  ).toEqual(["game.minecraft-java", "game.stardew-valley"]);
});
