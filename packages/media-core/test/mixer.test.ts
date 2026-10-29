import { test, expect } from "bun:test";
import { AudioMixer } from "../src/mixer";
test("film volume never changes voice, while member volume scales only that member voice", () => {
  const mix = new AudioMixer();
  const levels = { a: 0, b: 0, film: 0 };
  mix.attach("mic-a", "a", "voice", {
    setVolume: (v) => {
      levels.a = v;
    },
  });
  mix.attach("mic-b", "b", "voice", {
    setVolume: (v) => {
      levels.b = v;
    },
  });
  mix.attach("film", "a", "screen", {
    setVolume: (v) => {
      levels.film = v;
    },
  });
  mix.voice(0.8);
  mix.screen(0.25);
  mix.member("a", 0.5);
  expect(levels).toEqual({ a: 0.4, b: 0.8, film: 0.25 });
  mix.attach("film-new", "b", "screen", {
    setVolume: (v) => {
      levels.film = v;
    },
  });
  expect(levels.film).toBe(0.25);
});

test("members can be amplified to 200% without amplifying other people or film audio", () => {
  const mix = new AudioMixer();
  const levels = { a: 0, b: 0, film: 0 };
  mix.attach("a", "a", "voice", {
    setVolume: (v) => {
      levels.a = v;
    },
  });
  mix.attach("b", "b", "voice", {
    setVolume: (v) => {
      levels.b = v;
    },
  });
  mix.attach("film", "a", "screen", {
    setVolume: (v) => {
      levels.film = v;
    },
  });
  mix.member("a", 2);
  expect(levels).toEqual({ a: 2, b: 1, film: 1 });
  mix.voice(0.5);
  expect(levels).toEqual({ a: 1, b: 0.5, film: 1 });
  mix.voice(0);
  expect(levels).toEqual({ a: 0, b: 0, film: 1 });
  mix.voice(1);
  mix.remove("a");
  mix.attach("a-new", "a", "voice", {
    setVolume: (v) => {
      levels.a = v;
    },
  });
  expect(levels.a).toBe(2);
  mix.member("a", 200);
  expect(levels.a).toBe(2);
  for (const invalid of [-1, NaN, Infinity]) {
    mix.member("a", invalid);
    expect(levels.a).toBe(0);
  }
});

test("restored friend levels reach current and replacement tracks and account resets clear defaults", () => {
  const mix = new AudioMixer();
  const levels = { voice: 0, muted: 0, music: 0, film: 0 };
  mix.replaceMembers({ friend: 1.75, muted: 0 });
  mix.attach("voice", "friend", "voice", {
    setVolume: (v) => {
      levels.voice = v;
    },
  });
  mix.attach("muted", "muted", "voice", {
    setVolume: (v) => {
      levels.muted = v;
    },
  });
  mix.attach("music", "friend", "accompaniment", {
    setVolume: (v) => {
      levels.music = v;
    },
  });
  mix.attach("film", "friend", "screen", {
    setVolume: (v) => {
      levels.film = v;
    },
  });
  expect(levels).toEqual({ voice: 1.75, muted: 0, music: 1, film: 1 });
  mix.replaceMembers({ friend: 0.25, muted: 0 });
  expect(levels).toEqual({ voice: 0.25, muted: 0, music: 0.25, film: 1 });
  mix.replaceMembers({}, false);
  expect(levels.voice).toBe(0.25);
  mix.clear();
  mix.attach("new-account", "friend", "voice", {
    setVolume: (v) => {
      levels.voice = v;
    },
  });
  expect(levels.voice).toBe(1);
});
