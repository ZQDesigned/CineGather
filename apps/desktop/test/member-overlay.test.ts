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
      memberOverlay: { enabled: true, opacity: -1 },
    }).success,
  ).toBe(false);
});
test("overlay accepts fully transparent backgrounds without changing other settings", () => {
  const parsed = settingsSchema.parse({
    ...defaultSettings,
    memberOverlay: { enabled: true, position: "left-center", opacity: 0 },
  });
  expect(parsed.memberOverlay).toEqual({
    enabled: true,
    position: "left-center",
    opacity: 0,
  });
  expect(parsed.muteShortcut).toBe(defaultSettings.muteShortcut);
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

test("accompaniment has its own overlay status while the microphone stays closed", () => {
  const input = {
    ...active,
    media: {
      ...active.media,
      participants: [
        {
          id: "a",
          name: "伴奏",
          local: true,
          microphone: false,
          speaking: false,
          accompaniment: true,
        },
      ],
    },
  };
  expect(buildMemberOverlay(input)?.members[0]).toMatchObject({
    accompaniment: true,
    microphone: false,
    speaking: false,
  });
});

const esportsMember = (
  id: string,
  seat: import("@cinegather/contracts").EsportsSeat,
): import("@cinegather/contracts").EsportsSnapshot["self"] => ({
  userId: id,
  displayName: id,
  seat,
  revision: 1,
  online: true,
  reservedUntil: null,
  microphoneAllowed: true,
  sharingAllowed: true,
});
const esportsMembers = [
  esportsMember("a1", { kind: "player", team: "a" }),
  esportsMember("a2", { kind: "player", team: "a" }),
  esportsMember("b1", { kind: "player", team: "b" }),
  esportsMember("d1", { kind: "director" }),
  esportsMember("d2", { kind: "director" }),
  esportsMember("v1", { kind: "audience" }),
  esportsMember("v2", { kind: "audience" }),
];
function esportsOverlay(selfId: string) {
  return {
    ...active,
    user: { id: selfId },
    room: { ...active.room, mode: "esports" as const },
    esports: {
      snapshot: {
        roomId: active.room.id,
        self: esportsMembers.find((m) => m.userId === selfId)!,
        members: esportsMembers,
        publications: [
          {
            id: "pub-a1",
            userId: "a1",
            status: "active" as const,
            systemAudio: true,
          },
          {
            id: "pub-a2",
            userId: "a2",
            status: "active" as const,
            systemAudio: true,
          },
        ],
      },
    },
    media: {
      ...active.media,
      participants: esportsMembers.map((m) => ({
        id: m.userId,
        name: m.displayName,
        local: m.userId === selfId,
        microphone: true,
        speaking: true,
      })),
      sharer: { id: "a1" },
    },
  };
}
test("esports overlay shows only the viewer's own seat area even while monitoring a player team", () => {
  for (const [selfId, expected] of [
    ["a1", ["a1", "a2"]],
    ["b1", ["b1"]],
    ["d1", ["d1", "d2"]],
    ["v1", ["v1", "v2"]],
  ] as const) {
    expect(
      buildMemberOverlay(esportsOverlay(selfId))?.members.map((m) => m.id),
    ).toEqual([...expected]);
  }
});
test("esports overlay follows seat reassignment and reports concurrent teammate shares", () => {
  const input = esportsOverlay("a1");
  expect(buildMemberOverlay(input)?.members.map((m) => m.sharing)).toEqual([
    true,
    true,
  ]);
  const moved = esportsMember("a1", { kind: "director" });
  input.esports.snapshot = {
    ...input.esports.snapshot,
    self: moved,
    members: esportsMembers.map((m) => (m.userId === moved.userId ? moved : m)),
  };
  expect(buildMemberOverlay(input)?.members.map((m) => m.id)).toEqual([
    "a1",
    "d1",
    "d2",
  ]);
});
test("esports overlay waits for a matching seat snapshot instead of showing the whole room", () => {
  const input = esportsOverlay("a1");
  expect(buildMemberOverlay({ ...input, esports: undefined })).toBeNull();
  expect(
    buildMemberOverlay({
      ...input,
      esports: {
        snapshot: { ...input.esports.snapshot, roomId: "previous-room" },
      },
    }),
  ).toBeNull();
  expect(
    buildMemberOverlay({ ...input, user: { id: "another-account" } }),
  ).toBeNull();
});
