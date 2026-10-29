import { expect, test } from "bun:test";
import {
  KaraokeAudioMetrics,
  singingConstraints,
  singingOptions,
  karaokePlayoutTarget,
  requestKaraokeBuffer,
} from "../src/karaoke";
test("singing preserves musical dynamics, requires explicit echo choice and bounds compensation", () => {
  expect(singingConstraints(true)).toMatchObject({
    noiseSuppression: false,
    autoGainControl: false,
    echoCancellation: false,
    channelCount: 1,
  });
  expect(singingConstraints(false).echoCancellation).toBe(true);
  expect(
    singingOptions({ gain: 9, reverb: -1, monitor: 1, delayMs: 1000 }),
  ).toEqual({ gain: 2, reverb: 0, monitor: 0.5, delayMs: 200 });
  expect(singingOptions({ gain: NaN, delayMs: NaN })).toEqual({
    gain: 1,
    reverb: 0,
    monitor: 0,
    delayMs: 0,
  });
  expect(karaokePlayoutTarget(true)).toBe(0.01);
  expect(karaokePlayoutTarget(false)).toBe(0.06);
});
test("audio queue and loss use interval deltas, resets never fabricate a zero delay", () => {
  const m = new KaraokeAudioMetrics();
  const sample = (
    n: number,
    delay: number,
    count: number,
    concealed: number,
    total: number,
  ) =>
    m.sample("peer", [
      {
        type: "inbound-rtp",
        kind: "audio",
        timestamp: n,
        jitterBufferDelay: delay,
        jitterBufferEmittedCount: count,
        concealedSamples: concealed,
        totalSamplesReceived: total,
      },
      { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.018 },
    ]);
  expect(sample(1000, 1, 10, 10, 1000)).toMatchObject({ transportRttMs: 18 });
  expect(sample(1000, 1, 10, 10, 1000).queueMs).toBeUndefined();
  expect(sample(2000, 1.2, 20, 20, 2000)).toMatchObject({
    queueMs: expect.closeTo(20),
    concealedPercent: 1,
  });
  expect(sample(3000, 0.1, 1, 0, 100).queueMs).toBeUndefined();
  expect(m.sample("silent", [])).toEqual({});
  m.clear();
  expect(sample(4000, 2, 40, 40, 4000).queueMs).toBeUndefined();
});

test("buffer targets use supported receiver controls and report unsupported platforms honestly", () => {
  const standard = { jitterBufferTarget: null as number | null };
  expect(requestKaraokeBuffer(standard, 0.01)).toBe(true);
  expect(standard.jitterBufferTarget).toBe(10);
  requestKaraokeBuffer(standard);
  expect(standard.jitterBufferTarget).toBeNull();
  const legacy = { playoutDelayHint: undefined as number | undefined };
  expect(requestKaraokeBuffer(legacy, 0.06)).toBe(true);
  expect(legacy.playoutDelayHint).toBe(0.06);
  expect(requestKaraokeBuffer({}, 0.01)).toBe(false);
});
test("missing loss counters do not discard available queue measurements", () => {
  const m = new KaraokeAudioMetrics();
  const sample = (timestamp: number, delay: number, count: number) =>
    m.sample("peer", [
      {
        type: "inbound-rtp",
        kind: "audio",
        timestamp,
        jitterBufferDelay: delay,
        jitterBufferEmittedCount: count,
      },
    ]);
  sample(1000, 1, 100);
  expect(sample(2000, 3, 200)).toMatchObject({ queueMs: 20 });
});
