import { expect, test } from "bun:test";
import { Track } from "livekit-client";
import {
  ACCOMPANIMENT_TRACK,
  voicePublication,
  isAccompaniment,
} from "../src/audio-publications";
test("an accompaniment-only participant never masquerades as a microphone", () => {
  const accompaniment = {
    source: Track.Source.Microphone,
    trackName: ACCOMPANIMENT_TRACK,
  };
  const voice = { source: Track.Source.Microphone, trackName: "microphone" };
  const pubs = new Map([["bgm", accompaniment]]);
  expect(isAccompaniment(accompaniment)).toBe(true);
  expect(voicePublication(pubs)).toBeUndefined();
  pubs.set("voice", voice);
  expect(voicePublication(pubs)).toBe(voice);
});

test("voice boost does not amplify accompaniment and member/master mute still affect it", async () => {
  const { AudioMixer } = await import("../src/mixer");
  const mixer = new AudioMixer();
  let voice = 0,
    music = 0;
  mixer.attach("voice", "a", "voice", {
    setVolume: (value) => {
      voice = value;
    },
  });
  mixer.attach("music", "a", "accompaniment", {
    setVolume: (value) => {
      music = value;
    },
  });
  mixer.member("a", 2);
  expect(voice).toBe(2);
  expect(music).toBe(1);
  mixer.member("a", 0);
  expect(music).toBe(0);
  mixer.member("a", 1);
  mixer.voice(0);
  expect(voice).toBe(0);
  expect(music).toBe(0);
});
