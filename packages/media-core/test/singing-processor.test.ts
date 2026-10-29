import { expect, test } from "bun:test";
import { SingingProcessor } from "../src/singing-processor";
test("singing monitoring rejects unsupported selected outputs and teardown never closes SDK audio", async () => {
  const original = globalThis.MediaStream;
  let inputStops = 0,
    outputStops = 0,
    contextCloses = 0;
  const input = {
    stop() {
      inputStops++;
    },
  } as unknown as MediaStreamTrack;
  const output = {
    readyState: "live",
    stop() {
      outputStops++;
    },
  } as unknown as MediaStreamTrack;
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({
    connect(target: unknown) {
      return target;
    },
    disconnect() {},
  });
  const context = {
    state: "running",
    currentTime: 0,
    baseLatency: 0.01,
    destination: node(),
    resume: async () => {},
    close: async () => {
      contextCloses++;
    },
    createMediaStreamSource: node,
    createGain: () => ({ ...node(), gain: parameter() }),
    createDelay: () => ({ ...node(), delayTime: parameter() }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createMediaStreamDestination: () => ({
      ...node(),
      channelCount: 1,
      stream: { getAudioTracks: () => [output], getTracks: () => [output] },
    }),
  };
  try {
    globalThis.MediaStream = class {
      constructor(_tracks: MediaStreamTrack[]) {}
    } as unknown as typeof MediaStream;
    const processor = new SingingProcessor();
    await processor.init({
      track: input,
      audioContext: context as unknown as AudioContext,
      kind: "audio",
    } as Parameters<SingingProcessor["init"]>[0]);
    expect(processor.metrics.processorActive).toBe(true);
    await expect(processor.device("selected-headset", true)).rejects.toThrow(
      "不支持",
    );
    await processor.destroy();
    expect(inputStops).toBe(0);
    expect(outputStops).toBe(1);
    expect(contextCloses).toBe(0);
  } finally {
    globalThis.MediaStream = original;
  }
});
