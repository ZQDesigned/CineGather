import { expect, test } from "bun:test";
import { VoicePlayback } from "../src/voice-playback";
const player = () =>
  ({
    paused: false,
    style: {},
    dataset: {},
    play: async () => {},
    pause() {},
    remove() {},
  }) as unknown as HTMLMediaElement;
function fixture() {
  let inputsStopped = 0,
    outputStops = 0,
    disconnects = 0,
    closes = 0;
  const gains: number[] = [];
  const stream = {
    getTracks: () => [
      {
        stop: () => {
          outputStops++;
        },
      },
    ],
  } as unknown as MediaStream;
  const input = {
    getTracks: () => [
      {
        stop: () => {
          inputsStopped++;
        },
      },
    ],
  } as unknown as MediaStream;
  const context = {
    state: "running",
    currentTime: 12,
    onstatechange: null,
    createMediaStreamSource: () => ({
      connect() {},
      disconnect: () => {
        disconnects++;
      },
    }),
    createGain: () => ({
      gain: {
        value: 1,
        setTargetAtTime: (value: number) => {
          gains.push(value);
        },
      },
      connect() {},
      disconnect: () => {
        disconnects++;
      },
    }),
    createMediaStreamDestination: () => ({ stream }),
    resume: async () => {
      context.state = "running";
    },
    close: async () => {
      context.state = "closed";
      closes++;
    },
  };
  return {
    input,
    stream,
    context,
    gains,
    stats: () => ({ inputsStopped, outputStops, disconnects, closes }),
  };
}
test("voice gain reaches 2 through a single processed output; removing tracks stops only owned resources", () => {
  const f = fixture();
  const element = { srcObject: f.input, volume: 1 } as HTMLMediaElement;
  const playback = new VoicePlayback(
    () => {},
    () => {},
    () => f.context as unknown as AudioContext,
    player,
  );
  const fallback: number[] = [];
  const sink = playback.attach("a", f.input, element, {
    setVolume: (v) => {
      fallback.push(v);
    },
  });
  expect(element.srcObject).toBe(f.stream);
  expect(element.volume).toBe(1);
  for (const value of [1, 2, 0, 3, -1, NaN]) sink.setVolume(value);
  expect(f.gains).toEqual([1, 2, 0, 2, 0, 0]);
  expect(fallback).toEqual([]);
  expect(playback.blocked).toBe(false);
  playback.clear();
  expect(f.stats()).toEqual({
    inputsStopped: 0,
    outputStops: 1,
    disconnects: 2,
    closes: 1,
  });
  playback.clear();
  expect(f.stats().closes).toBe(1);
});
test("blocked contexts can be resumed and replaced subscriptions clean up their old graph", async () => {
  const f = fixture();
  f.context.state = "suspended";
  f.context.resume = async () => {};
  const element = { srcObject: f.input, volume: 1 } as HTMLMediaElement;
  const playback = new VoicePlayback(
    () => {},
    () => {},
    () => f.context as unknown as AudioContext,
    player,
  );
  playback.attach("a", f.input, element, { setVolume() {} });
  expect(playback.blocked).toBe(true);
  f.context.resume = async () => {
    f.context.state = "running";
  };
  await playback.resume();
  expect(playback.blocked).toBe(false);
  playback.attach("a", f.input, element, { setVolume() {} });
  expect(f.stats().outputStops).toBe(1);
  playback.remove("a");
  expect(f.stats().outputStops).toBe(2);
  playback.clear();
});
test("unsupported audio enhancement keeps bounded basic playback and warns once when boost is requested", () => {
  const fallback: number[] = [],
    errors: Error[] = [];
  const playback = new VoicePlayback(
    () => {},
    (e) => {
      errors.push(e);
    },
    () => {
      throw new Error("unsupported");
    },
    player,
  );
  const input = {} as MediaStream,
    element = { srcObject: input } as HTMLMediaElement;
  const sink = playback.attach("a", input, element, {
    setVolume: (v) => {
      fallback.push(v);
    },
  });
  for (const value of [0.5, 2, 2, 0]) sink.setVolume(value);
  expect(fallback).toEqual([0.5, 1, 1, 0]);
  expect(errors).toHaveLength(1);
  expect(element.srcObject).toBe(input);
  expect(playback.blocked).toBe(false);
  playback.clear();
});

test("direct music output waits for device selection and recycled voice elements unmute", async () => {
  const f = fixture();
  let outputConnections = 0,
    ready!: () => void;
  const output = {} as AudioDestinationNode;
  const context = {
    ...f.context,
    destination: output,
    setSinkId: () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    createGain: () => ({
      ...f.context.createGain(),
      connect: (target: unknown) => {
        if (target === output) outputConnections++;
      },
    }),
  };
  const element = {
    srcObject: f.input,
    volume: 1,
    muted: false,
  } as HTMLMediaElement;
  const music = new VoicePlayback(
    () => {},
    () => {},
    () => context as unknown as AudioContext,
    player,
    true,
  );
  music.attach("a", f.input, element, { setVolume() {} });
  expect(element.muted).toBe(true);
  expect(outputConnections).toBe(0);
  await Promise.resolve();
  ready();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(outputConnections).toBe(1);
  music.clear();
  const voice = new VoicePlayback(
    () => {},
    () => {},
    () => f.context as unknown as AudioContext,
    player,
  );
  voice.attach("b", f.input, element, { setVolume() {} });
  expect(element.muted).toBe(false);
  voice.clear();
});
