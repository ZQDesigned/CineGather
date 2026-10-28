import { test, expect } from "bun:test";
import { WatchPlaybackPolicy, WatchHealth } from "../src/watch-profile";

test("watching profiles apply the same buffer target to shared video/audio without changing speech or the source", () => {
  const policy = new WatchPlaybackPolicy();
  const video = {
    isLocal: false,
    receiver: { jitterBufferTarget: null as number | null },
  };
  const audio = {
    isLocal: false,
    receiver: { jitterBufferTarget: null as number | null },
  };
  expect(policy.apply(video, audio)).toBe(true);
  expect(video.receiver.jitterBufferTarget).toBe(150);
  expect(audio.receiver.jitterBufferTarget).toBe(150);
  policy.profile = "smooth";
  policy.apply(video, audio);
  expect(video.receiver.jitterBufferTarget).toBe(350);
  policy.profile = "low-latency";
  policy.apply(video, audio);
  expect(audio.receiver.jitterBufferTarget).toBe(0);
});

test("legacy seconds and new receivers after resubscribe get the profile; unsupported, ended and local tracks fail safely", () => {
  const policy = new WatchPlaybackPolicy();
  policy.profile = "smooth";
  const legacy = { isLocal: false, receiver: { playoutDelayHint: 0 } };
  expect(policy.apply(legacy)).toBe(true);
  expect(legacy.receiver.playoutDelayHint).toBe(0.35);
  legacy.receiver.playoutDelayHint = 0; // The SDK resets legacy hints when reusing a transceiver.
  policy.apply(legacy);
  expect(legacy.receiver.playoutDelayHint).toBe(0.35);
  expect(policy.apply({ isLocal: false, receiver: {} })).toBe(false);
  expect(
    policy.apply({ isLocal: true, receiver: { jitterBufferTarget: 0 } }),
  ).toBeUndefined();
  const replacement = { isLocal: false, receiver: { jitterBufferTarget: 0 } };
  policy.apply(replacement);
  expect(replacement.receiver.jitterBufferTarget).toBe(350);
  expect(policy.apply({ isLocal: false })).toBeUndefined();
});

test("unsupported target setters do not pretend to take effect or break audio playback", () => {
  const policy = new WatchPlaybackPolicy();
  expect(
    policy.apply({
      isLocal: false,
      receiver: {
        set jitterBufferTarget(_v: number) {
          throw Error("unsupported");
        },
      },
    }),
  ).toBe(false);
});

test("stall suggestions need sustained network jitter and never count deliberate background suspension or static video alone", () => {
  const health = new WatchHealth();
  const sample = (at: number, visible = true, jitter = 0.08) =>
    health.sample({
      track: "screen",
      at,
      watching: true,
      visible,
      profile: "balanced",
      jitter,
      frameAgeMs: 1000,
    });
  expect(sample(0)).toBeUndefined();
  expect(sample(2000)).toBeUndefined();
  expect(sample(4000)).toBeUndefined();
  expect(sample(6000)).toBe("network");
  expect(sample(8000, false)).toBeUndefined();
  for (let t = 10000; t < 25000; t += 2000)
    expect(sample(t, true, 0)).toBeUndefined();
  expect(sample(26000)).toBeUndefined();
  expect(
    health.sample({
      track: "new-screen",
      at: 28000,
      watching: true,
      visible: true,
      profile: "balanced",
      jitter: 0.08,
      frameAgeMs: 1000,
    }),
  ).toBeUndefined();
});

test("already smooth playback gets no redundant switch recommendation; good playback clears the advice", () => {
  const health = new WatchHealth();
  for (let at = 0; at <= 6000; at += 2000)
    health.sample({
      track: "screen",
      at,
      watching: true,
      visible: true,
      profile: "smooth",
      jitter: 0.1,
      frameAgeMs: 1000,
    });
  expect(
    health.sample({
      track: "screen",
      at: 8000,
      watching: true,
      visible: true,
      profile: "smooth",
      jitter: 0.1,
      frameAgeMs: 1000,
    }),
  ).toBe("network-persistent");
  expect(
    health.sample({
      track: "screen",
      at: 10000,
      watching: true,
      visible: true,
      profile: "smooth",
      jitter: 0,
      frameAgeMs: 10,
    }),
  ).toBe("network-persistent");
  health.sample({
    track: "screen",
    at: 12000,
    watching: true,
    visible: true,
    profile: "smooth",
    jitter: 0,
    frameAgeMs: 10,
  });
  expect(
    health.sample({
      track: "screen",
      at: 14000,
      watching: true,
      visible: true,
      profile: "smooth",
      jitter: 0,
      frameAgeMs: 10,
    }),
  ).toBeUndefined();
});
