import { expect, test } from "bun:test";
import { ktvImpulse } from "../src/ktv-reverb";
test("KTV impulse has a deterministic bounded room tail which decays instead of feeding back", () => {
  const impulse = ktvImpulse(48000);
  expect(impulse.length).toBe(57600);
  expect(impulse).toEqual(ktvImpulse(48000));
  expect([...impulse].every(Number.isFinite)).toBe(true);
  const energy = (start: number, end: number) =>
    impulse.slice(start, end).reduce((sum, x) => sum + x * x, 0) /
    (end - start);
  expect(energy(0, 4800)).toBeGreaterThan(energy(48000, 52800) * 1000);
  expect(energy(4800, 9600)).toBeGreaterThan(0);
  expect(ktvImpulse(44100).length).toBe(52920);
});

test("the KTV graph follows denoising, gates mute and releases only its own resources", async () => {
  const { KtvReverb } = await import("../src/ktv-reverb");
  const original = globalThis.MediaStream;
  let rawStops = 0,
    filteredStops = 0,
    outputStops = 0,
    closes = 0,
    speakerRoutes = 0;
  const raw = {
    stop() {
      rawStops++;
    },
  } as unknown as MediaStreamTrack;
  const filtered = {
    stop() {
      filteredStops++;
    },
  } as unknown as MediaStreamTrack;
  const output = {
    stop() {
      outputStops++;
    },
  } as unknown as MediaStreamTrack;
  const gains: {
    value: number;
    last?: number;
    setValueAtTime(v: number): void;
  }[] = [];
  const speaker = {};
  const node = () => ({
    connect(target: unknown) {
      if (target === speaker) speakerRoutes++;
      return target;
    },
    disconnect() {},
  });
  const parameter = () => ({
    value: 0,
    last: undefined as number | undefined,
    setValueAtTime(v: number) {
      this.last = v;
    },
  });
  const inner = {
    name: "filter",
    processedTrack: filtered,
    init: async () => {},
    restart: async () => {},
    destroy: async () => {
      filtered.stop();
    },
  };
  const context = {
    sampleRate: 48000,
    currentTime: 0,
    destination: speaker,
    close: async () => {
      closes++;
    },
    createMediaStreamSource: (stream: { tracks: MediaStreamTrack[] }) => {
      expect(stream.tracks[0]).toBe(filtered);
      return node();
    },
    createGain: () => {
      const gain = parameter();
      gains.push(gain);
      return { ...node(), gain };
    },
    createDelay: () => ({ ...node(), delayTime: parameter() }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: parameter() }),
    createConvolver: () => ({ ...node(), buffer: undefined as unknown }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createMediaStreamDestination: () => ({
      ...node(),
      channelCount: 1,
      stream: { getAudioTracks: () => [output], getTracks: () => [output] },
    }),
  };
  try {
    globalThis.MediaStream = class {
      constructor(public tracks: MediaStreamTrack[]) {}
    } as unknown as typeof MediaStream;
    const p = new KtvReverb(inner, () => true);
    await p.init({
      track: raw,
      audioContext: context as unknown as AudioContext,
      kind: "audio",
    } as import("livekit-client").AudioProcessorOptions);
    expect(gains[3]!.value).toBe(0);
    p.setMuted(false);
    expect(gains[3]!.last).toBe(1);
    p.setMuted(true);
    expect(gains[3]!.last).toBe(0);
    expect(speakerRoutes).toBe(0);
    await p.destroy();
    expect(rawStops).toBe(0);
    expect(filteredStops).toBe(1);
    expect(outputStops).toBe(1);
    expect(closes).toBe(0);
  } finally {
    globalThis.MediaStream = original;
  }
});
