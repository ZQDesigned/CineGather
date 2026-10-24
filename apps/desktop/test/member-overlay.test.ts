import { expect, test } from "bun:test";
import {
  buildMemberOverlay,
  overlayBounds,
  overlaySnapshotSchema,
} from "../src/shared/member-overlay";
import { defaultSettings, settingsSchema } from "../src/shared/settings";

const active = {
  user: { id: "a" },
  room: {
    id: "room",
    name: "一起看",
    ownerUserId: "b",
    memberPermissions: [{ userId: "b", microphoneAllowed: false }],
  },
  roomState: "connected",
  media: {
    state: "connected",
    participants: [
      { id: "a", name: "自己", local: true, microphone: true, speaking: true },
      { id: "b", name: "朋友", local: false, microphone: true, speaking: true },
      {
        id: "cg-native:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222",
        name: "capture",
        local: false,
        microphone: false,
        speaking: false,
      },
    ],
    sharer: { id: "a" },
  },
  sessionToken: "secret",
};
test("overlay snapshot carries only display state and obeys microphone permissions", () => {
  const snapshot = buildMemberOverlay(active)!;
  expect(snapshot.members).toHaveLength(2);
  expect(snapshot.members[0]).toEqual({
    id: "a",
    name: "自己",
    local: true,
    owner: false,
    microphone: true,
    speaking: true,
    sharing: true,
  });
  expect(snapshot.members[1]).toMatchObject({
    owner: true,
    microphone: false,
    speaking: false,
  });
  expect(JSON.stringify(snapshot)).not.toContain("secret");
  expect(
    overlaySnapshotSchema.parse({ ...snapshot, sessionToken: "leaked" }),
  ).not.toHaveProperty("sessionToken");
});
test("overlay clears for logout, leaving, lost media and forced update", () => {
  for (const state of [
    { ...active, user: undefined },
    { ...active, room: undefined },
    { ...active, roomState: "leaving" },
    { ...active, media: { ...active.media, state: "reconnecting" } },
    { ...active, requiredUpdate: {} },
  ])
    expect(buildMemberOverlay(state)).toBeNull();
});
test("old settings gain overlay preferences and invalid preferences are rejected", () => {
  const { memberOverlay: _, ...old } = defaultSettings;
  expect(settingsSchema.parse(old).memberOverlay).toEqual({
    enabled: true,
    opacity: 85,
    position: "right-top",
  });
  expect(
    settingsSchema.safeParse({
      ...old,
      memberOverlay: { enabled: true, opacity: 0 },
    }).success,
  ).toBe(false);
});
test("overlay stays anchored to the chosen side of any display work area", () => {
  const area = { x: -1920, y: 25, width: 1920, height: 1055 };
  expect(overlayBounds("left-top", 2, area)).toEqual({
    x: -1912,
    y: 33,
    width: 256,
    height: 118,
  });
  expect(overlayBounds("right-center", 2, area)).toEqual({
    x: -264,
    y: 494,
    width: 256,
    height: 118,
  });
  expect(overlayBounds("left-bottom", 10, area)).toEqual({
    x: -1912,
    y: 650,
    width: 256,
    height: 422,
  });
  expect(
    overlayBounds("right-top", 1, { x: 0, y: 25, width: 1440, height: 875 }),
  ).toEqual({ x: 1176, y: 33, width: 256, height: 80 });
});
