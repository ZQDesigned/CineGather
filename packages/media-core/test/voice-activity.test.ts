import { expect, test } from "bun:test";
import { VoiceActivity } from "../src/voice-activity";
test("speaker indication measures only the bound voice, never the accompaniment or output gain", async () => {
  let level = 0,
    closed = false;
  const links: unknown[] = [];
  const analyser = {
    fftSize: 512,
    getFloatTimeDomainData: (data: Float32Array) => data.fill(level),
    connect: () => {},
    disconnect: () => {},
  };
  const gain = { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
  const context = {
    state: "running",
    createMediaStreamSource: () => ({
      connect: (node: unknown) => links.push(node),
      disconnect: () => {},
    }),
    createAnalyser: () => analyser,
    createGain: () => gain,
    destination: {},
    resume: async () => {},
    close: async () => {
      closed = true;
    },
  };
  const activity = new VoiceActivity(() => context as unknown as AudioContext);
  activity.bind("voice", {} as MediaStream);
  expect(activity.active("voice")).toBe(false);
  level = 0.05;
  expect(activity.active("voice")).toBe(true);
  expect(activity.active("accompaniment")).toBeUndefined();
  expect(gain.gain.value).toBe(0);
  expect(links).toEqual([analyser]);
  activity.remove("voice");
  expect(activity.active("voice")).toBeUndefined();
  activity.clear();
  expect(closed).toBe(true);
});
