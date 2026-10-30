import { test, expect } from "bun:test";
import { VideoHealth } from "../src/video-health";
const point = (
  at: number,
  received = 30,
  decoded = 30,
  shown = 30,
  loss = 0,
) => ({
  track: "screen-1",
  at,
  watching: true,
  visible: true,
  stats: {
    framesReceived: (at / 1000) * received,
    framesDecoded: (at / 1000) * decoded,
    packetsReceived: (at / 1000) * 100,
    packetsLost: (at / 1000) * loss,
    jitter: loss ? 0.09 : 0.002,
    totalDecodeTime: (at / 1000) * decoded * (decoded < received ? 0.1 : 0.005),
  },
  playback: {
    presentedFrames: (at / 1000) * shown,
    frameAgeMs: shown ? 30 : 1500,
    paused: false,
  },
});
const stable = (received: number, decoded: number, shown: number, loss = 0) => {
  const health = new VideoHealth();
  let result;
  for (let at = 0; at <= 12000; at += 2000)
    result = health.sample(point(at, received, decoded, shown, loss));
  return result;
};
test("normal receive/decode/presentation counters produce a healthy picture", () => {
  expect(stable(30, 30, 30)?.kind).toBe("smooth");
});
test("loss with playback starvation indicates network, incoming frames with stalled decode indicate local decode", () => {
  expect(stable(3, 3, 3, 25)?.kind).toBe("network");
  expect(stable(30, 3, 3)?.kind).toBe("decode");
  expect(stable(30, 30, 3)?.kind).toBe("render");
});
test("static or sparse source updates stay neutral, never an asserted sender fault", () => {
  expect(stable(0, 0, 0)?.kind).toBe("few-updates");
  expect(stable(3, 3, 3)?.kind).toBe("few-updates");
});
test("absent stats and presentation evidence cannot be called smooth", () => {
  const h = new VideoHealth();
  let r;
  for (let at = 0; at <= 12000; at += 2000)
    r = h.sample({ ...point(at), stats: {}, playback: undefined });
  expect(r?.kind).toBe("unavailable");
});
test("brief stalls do not flash warnings; hidden and fresh tracks clear old diagnoses", () => {
  const h = new VideoHealth();
  h.sample(point(0));
  expect(h.sample(point(2000, 30, 3, 3))?.kind).not.toBe("decode");
  for (let at = 4000; at <= 12000; at += 2000) h.sample(point(at, 30, 3, 3));
  expect(h.sample({ ...point(14000, 30, 3, 3), visible: false })?.kind).toBe(
    "paused",
  );
  expect(h.sample({ ...point(16000), track: "replacement" })?.kind).toBe(
    "checking",
  );
  expect(h.sample(point(30000))?.kind).toBe("checking");
});
