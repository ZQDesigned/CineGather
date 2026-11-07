import type { AudioProcessorOptions } from "livekit-client";
import { expect, test } from "bun:test";
import { createMicrophoneProcessor } from "../src/microphone-processor";
test("input volume is available with noise and effects both disabled", async () => {
  const processor = await createMicrophoneProcessor(
    "off",
    "none",
    undefined,
    () => false,
    40,
    150,
  );
  expect(processor).toBeDefined();
  await processor?.destroy();
});

test("live input gain preserves mute and denoising/reverb controls without replacing tracks or playing to speakers", async () => {
  const { MicrophoneInput } = await import("../src/microphone-input");
  const original = globalThis.MediaStream;
  let rawStops = 0,
    outputStops = 0,
    destroyed = 0,
    speakerRoutes = 0;
  const strengths: number[] = [],
    mutes: boolean[] = [];
  const raw = {
      stop() {
        rawStops++;
      },
    },
    filtered = {},
    output = {
      stop() {
        outputStops++;
      },
    };
  const parameters: {
    value: number;
    target?: number;
    last?: number;
    setTargetAtTime(v: number): void;
    setValueAtTime(v: number): void;
  }[] = [];
  const node = () => ({
    connect(target: unknown) {
      if (target === speaker) speakerRoutes++;
      return target;
    },
    disconnect() {},
  });
  const parameter = (value = 0) => ({
    value,
    target: undefined as number | undefined,
    last: undefined as number | undefined,
    setTargetAtTime(v: number) {
      this.target = v;
    },
    setValueAtTime(v: number) {
      this.last = v;
    },
  });
  const speaker = {};
  const context = {
    currentTime: 1,
    destination: speaker,
    createGain() {
      const gain = parameter();
      parameters.push(gain);
      return { ...node(), gain };
    },
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createMediaStreamSource: (s: { tracks: unknown[] }) => {
      expect(s.tracks[0]).toBe(filtered);
      return node();
    },
    createMediaStreamDestination: () => ({
      ...node(),
      channelCount: 1,
      stream: { getAudioTracks: () => [output], getTracks: () => [output] },
    }),
  };
  globalThis.MediaStream = class {
    constructor(public tracks: unknown[]) {}
  } as unknown as typeof MediaStream;
  try {
    const inner = {
      name: "inner",
      processedTrack: filtered,
      init: async () => {},
      restart: async () => {},
      destroy: async () => {
        destroyed++;
      },
      setStrength: (v: number) => strengths.push(v),
      setMuted: (v: boolean) => mutes.push(v),
    };
    const processor = new MicrophoneInput(
      inner as unknown as NonNullable<
        ConstructorParameters<typeof MicrophoneInput>[0]
      >,
      () => true,
      150,
    );
    await processor.init({
      audioContext: context,
      track: raw,
    } as unknown as AudioProcessorOptions);
    expect(parameters[0]!.value).toBe(1.5);
    expect(parameters[1]!.value).toBe(0);
    const track = processor.processedTrack;
    processor.setInputVolume(200);
    expect(parameters[0]!.target).toBe(2);
    expect(parameters[1]!.value).toBe(0);
    processor.setMuted(false);
    expect(parameters[1]!.last).toBe(1);
    processor.setInputVolume(0);
    expect(parameters[0]!.target).toBe(0);
    processor.setMuted(true);
    processor.setInputVolume(100);
    expect(parameters[1]!.last).toBe(0);
    processor.setStrength(90);
    expect(strengths).toEqual([90]);
    expect(mutes).toEqual([false, true]);
    expect(processor.processedTrack).toBe(track);
    expect(speakerRoutes).toBe(0);
    await processor.destroy();
    expect(rawStops).toBe(0);
    expect(outputStops).toBe(1);
    expect(destroyed).toBe(1);
  } finally {
    globalThis.MediaStream = original;
  }
});
