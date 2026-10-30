import { test, expect } from "bun:test";
import { MicrophoneMonitor } from "../src/microphone-monitor";
import type { MonitorEnvironment } from "../src/microphone-monitor";
const settings = {
  inputDevice: "",
  outputDevice: "",
  noiseReduction: "off" as const,
  microphoneEffect: "ktv" as const,
  microphoneReverbStrength: 40,
  microphoneMonitorVolume: 30,
};
function fixture() {
  let stops = 0,
    closed = 0,
    captures = 0;
  const strengths: number[] = [];
  const track = {
    readyState: "live",
    stop() {
      stops++;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const gain = {
    value: 0,
    setTargetAtTime(v: number) {
      this.value = v;
    },
    setValueAtTime(v: number) {
      this.value = v;
    },
  };
  const node = () => ({
    connect() {
      return node();
    },
    disconnect() {},
  });
  const context = {
    state: "running",
    currentTime: 0,
    baseLatency: 0.01,
    outputLatency: 0.01,
    destination: node(),
    resume: async () => {},
    close: async () => {
      closed++;
    },
    setSinkId: async (_id: string) => {},
    createMediaStreamSource: () => node(),
    createGain: () => ({ ...node(), gain }),
  };
  const env = {
    capture: async () => {
      captures++;
      return stream;
    },
    context: () => context,
    processor: async () => ({
      name: "filter",
      init: async () => {},
      restart: async () => {},
      destroy: async () => {},
      setStrength(v: number) {
        strengths.push(v);
      },
    }),
    inventory: async () => [],
    events: () => undefined,
  } as unknown as MonitorEnvironment;
  return {
    env,
    context,
    stream,
    gain,
    strengths,
    counts: () => ({ stops, closed, captures }),
  };
}
test("stopping while microphone permission is pending releases the late capture without starting playback", async () => {
  const f = fixture();
  let resolve!: (s: MediaStream) => void;
  f.env.capture = () => new Promise((r) => (resolve = r));
  const monitor = new MicrophoneMonitor(() => {}, f.env);
  const work = monitor.enable(settings);
  await monitor.stop();
  resolve(f.stream as unknown as MediaStream);
  await work;
  expect(f.counts().stops).toBe(1);
  expect(f.counts().closed).toBe(0);
  expect(monitor.status.state).toBe("off");
});
test("selected output failure never falls back to speakers and releases microphone and context", async () => {
  const f = fixture();
  f.context.setSinkId = async () => {
    throw Error("private output id");
  };
  const monitor = new MicrophoneMonitor(() => {}, f.env);
  await expect(
    monitor.enable({ ...settings, outputDevice: "missing-output" }),
  ).rejects.toThrow("耳返");
  expect(f.counts()).toEqual({ stops: 1, closed: 1, captures: 1 });
  expect(monitor.status.state).toBe("off");
  expect(f.gain.value).toBe(0);
});
test("live strength, monitor volume and output routing retain the existing local capture", async () => {
  const f = fixture(),
    monitor = new MicrophoneMonitor(() => {}, f.env);
  await monitor.enable(settings);
  expect(monitor.status.state).toBe("active");
  monitor.volume(75);
  monitor.strength(100);
  await monitor.configure({
    ...settings,
    outputDevice: "headphones",
    microphoneReverbStrength: 100,
    microphoneMonitorVolume: 75,
  });
  expect(f.counts().captures).toBe(1);
  expect(f.strengths.at(-1)).toBe(100);
  expect(f.gain.value).toBe(0.75);
  await monitor.stop();
  expect(f.counts()).toEqual({ stops: 1, closed: 1, captures: 1 });
  expect(f.gain.value).toBe(0);
});

test("a changed default output closes monitoring rather than following it onto another device", async () => {
  const f = fixture(),
    events = new EventTarget();
  let group = "headphones";
  f.env.events = () => events;
  f.env.inventory = async () =>
    [
      {
        kind: "audiooutput",
        deviceId: "default",
        groupId: group,
        label: group,
      },
    ] as MediaDeviceInfo[];
  const monitor = new MicrophoneMonitor(() => {}, f.env);
  await monitor.enable(settings);
  group = "speakers";
  events.dispatchEvent(new Event("devicechange"));
  await new Promise((r) => setTimeout(r, 0));
  expect(monitor.status).toMatchObject({
    state: "off",
    reason: "device-changed",
  });
  expect(f.gain.value).toBe(0);
  expect(f.counts().stops).toBe(1);
});
