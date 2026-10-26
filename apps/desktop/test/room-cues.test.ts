import { expect, test } from "bun:test";
import { RoomPresenceCues } from "../src/renderer/room-cues";
import { defaultSettings, settingsSchema } from "../src/shared/settings";
const summary = (ids: string[], state = "connected") => ({
  state,
  participants: ids.map((id) => ({ id, local: id === "self" })),
});
test("entry establishes a baseline and changes only sound once for real members", () => {
  const sounds: string[] = [];
  let now = 1000;
  const cues = new RoomPresenceCues(
    (kind) => sounds.push(kind),
    () => now,
  );
  cues.observe(summary(["self", "a"]));
  expect(sounds).toEqual([]);
  cues.enter(summary(["self", "a"]));
  expect(sounds).toEqual(["enter"]);
  cues.observe(summary(["a", "self"]));
  cues.observe(summary(["a", "self", "b"]));
  expect(sounds).toEqual(["enter", "enter"]);
  cues.observe(summary(["self", "a", "b", "c"]));
  expect(sounds).toHaveLength(2);
  now += 1000;
  cues.observe(summary(["self", "a", "c"]));
  expect(sounds.at(-1)).toBe("leave");
  cues.leave();
  cues.observe(summary([]));
  cues.leave();
  expect(sounds).toEqual(["enter", "enter", "leave", "leave"]);
});
test("network reconnection and inactive snapshots do not invent membership cues", () => {
  const sounds: string[] = [];
  const cues = new RoomPresenceCues((kind) => sounds.push(kind));
  cues.enter(summary(["self", "a"]));
  cues.observe(summary([], "reconnecting"));
  cues.observe(summary(["self", "b"]));
  cues.observe(summary(["b", "self"]));
  expect(sounds).toEqual(["enter"]);
  cues.reset();
  cues.observe(summary(["self", "a"]));
  cues.leave();
  expect(sounds).toEqual(["enter"]);
});
test("older preferences default room sounds on and explicit off persists", () => {
  const legacy = { ...defaultSettings } as Record<string, unknown>;
  delete legacy.roomSounds;
  expect(settingsSchema.parse(legacy).roomSounds).toBe(true);
  expect(
    settingsSchema.parse({ ...defaultSettings, roomSounds: false }).roomSounds,
  ).toBe(false);
});

test("disabled sounds and a removed output device remain silent without queuing", async () => {
  const { RoomCuePlayer } = await import("../src/renderer/room-cues");
  let plays = 0;
  let enabled = false;
  const audio = {
    src: "",
    volume: 0,
    pause() {},
    async play() {
      plays++;
    },
    async setSinkId() {
      throw new Error("Device removed");
    },
  } as unknown as HTMLAudioElement;
  const player = new RoomCuePlayer(
    { enter: "entry.wav", leave: "exit.wav" },
    () => ({ roomSounds: enabled, outputDevice: "headset" }),
    () => audio,
  );
  player.play("enter");
  enabled = true;
  player.play("leave");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(plays).toBe(0);
});
test("a newer cue or disabling playback cancels a pending device selection", async () => {
  const { RoomCuePlayer } = await import("../src/renderer/room-cues");
  const pending: (() => void)[] = [];
  const played: string[] = [];
  const audio = {
    src: "",
    volume: 0,
    pause() {},
    async play(this: { src: string }) {
      played.push(this.src);
    },
    setSinkId() {
      return new Promise<void>((resolve) => pending.push(resolve));
    },
  } as unknown as HTMLAudioElement;
  const player = new RoomCuePlayer(
    { enter: "entry.wav", leave: "exit.wav" },
    () => ({ outputDevice: "" }),
    () => audio,
  );
  player.play("enter");
  player.play("leave");
  pending[1]!();
  pending[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(played).toEqual(["exit.wav"]);
  player.play("enter");
  player.stop();
  pending[2]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(played).toEqual(["exit.wav"]);
});
