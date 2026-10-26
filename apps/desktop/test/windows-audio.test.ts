import { expect, test, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  AudioPackets,
  audioTarget,
  supportsProcessAudio,
  WindowsAudio,
} from "../src/main/windows-audio";
import type { ProcessAudioPacket } from "@cinegather/contracts";
import { PcmQueue } from "../src/renderer/process-audio-buffer";

function packet(frames = 480, timestamp = 1230000n) {
  const data = Buffer.alloc(16 + frames * 4);
  data.writeUInt32LE(frames * 4);
  data.writeBigUInt64LE(timestamp, 8);
  return data;
}
function fixture(supported = true, timeoutMs = 1000) {
  const createChild = () =>
    Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: mock(() => true),
    });
  const child = createChild();
  const children = [child];
  let starts = 0;
  const launch = mock(
    (_executable: string, _args: string[], _options: unknown) => {
      const next = starts++ === 0 ? child : createChild();
      if (next !== child) children.push(next);
      return next as unknown as ChildProcessWithoutNullStreams;
    },
  );
  const packets: ProcessAudioPacket[] = [];
  const failed = mock(() => {});
  const audio = new WindowsAudio({
    executable: "host.exe",
    supported,
    ownerPid: 123,
    data: (p) => packets.push(p),
    failed,
    spawn: launch as unknown as typeof spawn,
    timeoutMs,
  });
  return { audio, child, children, launch, packets, failed };
}
test("WASAPI modes use selected HWND or exclude our process tree, never a renderer-supplied PID", () => {
  expect(audioTarget("window:4294967298:0")).toEqual({
    mode: "window",
    window: "4294967298",
  });
  expect(audioTarget("screen:0:0")).toEqual({ mode: "screen", window: "0" });
  for (const id of [
    "window:0:0",
    "window:-1:0",
    "window:18446744073709551616:0",
    "window:1;evil:0",
    "pid:12",
  ])
    expect(() => audioTarget(id)).toThrow();
  expect(supportsProcessAudio("10.0.19040")).toBe(false);
  expect(supportsProcessAudio("10.0.19041")).toBe(true);
  expect(supportsProcessAudio("10.0.19045")).toBe(true);
  expect(supportsProcessAudio("10.0.20348")).toBe(true);
  expect(supportsProcessAudio("10.0.26100")).toBe(true);
});
test("PCM packets survive split headers, combined chunks and invalid data is bounded", () => {
  const decoder = new AudioPackets();
  const received: [number, number][] = [];
  const read = (data: Uint8Array, time: number) =>
    received.push([data.length, time]);
  const a = packet();
  decoder.push(a.subarray(0, 7), read);
  decoder.push(Buffer.concat([a.subarray(7), packet(960)]), read);
  expect(received).toEqual([
    [1920, 123],
    [3840, 123],
  ]);
  expect(() => new AudioPackets().push(Buffer.alloc(16), read)).toThrow();
  expect(() => new AudioPackets().push(Buffer.alloc(1000001), read)).toThrow();
});
test("one-shot display grant, Windows READY line endings, backpressure and stop/restart isolation", async () => {
  const { audio, child, launch, packets, failed } = fixture();
  await expect(audio.start()).rejects.toThrow("重新选择");
  audio.grant({ sourceId: "window:456:0", systemAudio: true });
  const started = audio.start();
  const first = packet();
  child.stdout.write(first.subarray(0, 8)); // stdout may arrive before stderr READY.
  child.stderr.write("READY\r\n");
  const { sessionId: id, mode } = await started;
  expect(mode).toBe("isolated");
  child.stdout.write(first.subarray(8));
  for (let i = 0; i < 10; ++i) child.stdout.write(packet());
  expect(packets).toHaveLength(4);
  audio.acknowledge("stale", packets[0]!.sequence);
  child.stdout.write(packet());
  expect(packets).toHaveLength(4);
  audio.acknowledge(id, packets[0]!.sequence);
  child.stdout.write(packet());
  expect(packets).toHaveLength(5);
  expect(launch.mock.calls[0]).toEqual([
    "host.exe",
    ["window", "456", "123"],
    { windowsHide: true, stdio: "pipe" },
  ]);
  audio.stop();
  child.stdout.write(packet());
  child.emit("exit", 0);
  expect(packets).toHaveLength(5);
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  await expect(audio.start()).rejects.toThrow("重新选择");
});
test("unsupported isolation uses device loopback and reports compatibility mode", async () => {
  const unsupported = fixture(false);
  unsupported.audio.grant({ sourceId: "screen:0:0", systemAudio: true });
  const started = unsupported.audio.start();
  unsupported.child.stderr.write("READY\r\n");
  await expect(started).resolves.toMatchObject({
    mode: "device",
    sessionId: expect.any(String),
  });
  expect(unsupported.launch.mock.calls[0]?.[1]).toEqual(["device", "0", "123"]);
  unsupported.audio.stop();
});
test("an unavailable process interface retries once using device audio; stale child events cannot stop it", async () => {
  const f = fixture();
  f.audio.grant({ sourceId: "window:456:0", systemAudio: true });
  const started = f.audio.start();
  f.child.stderr.write("ERROR activate-result 80070057\r\n");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.launch).toHaveBeenCalledTimes(2);
  expect(f.launch.mock.calls[1]?.[1]).toEqual(["device", "456", "123"]);
  f.child.emit("exit", 1);
  f.children[1]!.stderr.write("READY\n");
  await expect(started).resolves.toMatchObject({ mode: "device" });
  expect(f.failed).not.toHaveBeenCalled();
  f.audio.stop();
});
test("device audio still requires explicit consent; cancellation, closed windows and helper load errors never broaden capture", async () => {
  const noAudio = fixture();
  noAudio.audio.grant({ sourceId: "window:2:0", systemAudio: false });
  await expect(noAudio.audio.start()).rejects.toThrow("重新选择");
  const unsupportedNoConsent = fixture(false);
  await expect(unsupportedNoConsent.audio.start()).rejects.toThrow("重新选择");
  expect(unsupportedNoConsent.launch).not.toHaveBeenCalled();
  for (const mode of [
    "window",
    "process",
    "cancel",
    "load",
    "denied",
  ] as const) {
    const f = fixture(true, 10);
    f.audio.grant({ sourceId: "screen:0:0", systemAudio: true });
    const promise = f.audio.start();
    void promise.catch(() => {});
    if (mode === "window" || mode === "process")
      f.child.stderr.write(`ERROR ${mode} 80070005\r\n`);
    if (mode === "cancel") f.audio.stop();
    if (mode === "load") f.child.emit("error", new Error("ENOENT"));
    if (mode === "denied")
      f.child.stderr.write("ERROR activate-result 80070005\n");
    await expect(promise).rejects.toThrow();
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  }
});
test("isolation timeout tries device mode only once, and device failure stops instead of retrying forever", async () => {
  const f = fixture(true, 5);
  f.audio.grant({ sourceId: "screen:0:0", systemAudio: true });
  await expect(f.audio.start()).rejects.toThrow();
  expect(f.launch).toHaveBeenCalledTimes(2);
  expect(f.children.every((child) => child.kill.mock.calls.length === 1)).toBe(
    true,
  );
});
test("cancelling between isolation failure and retry cannot start device capture", async () => {
  const f = fixture();
  f.audio.grant({ sourceId: "window:456:0", systemAudio: true });
  const promise = f.audio.start();
  void promise.catch(() => {});
  f.child.stderr.write("ERROR activate-result 80070057\n");
  f.audio.stop();
  await expect(promise).rejects.toThrow();
  expect(f.launch).toHaveBeenCalledTimes(1);
});
test("a helper failure after startup notifies the active sharing session", async () => {
  const f = fixture();
  f.audio.grant({ sourceId: "window:456:0", systemAudio: true });
  const promise = f.audio.start();
  f.child.stderr.write("READY\n");
  const { sessionId: id } = await promise;
  f.child.emit("exit", 1);
  expect(f.failed).toHaveBeenCalledWith(id, expect.stringContaining("中断"));
  expect(f.launch).toHaveBeenCalledTimes(1);
});
test("stereo samples keep channel separation, fill underruns with silence and discard old backlog", () => {
  const queue = new PcmQueue();
  const stereo = new Int16Array(1920);
  for (let i = 0; i < stereo.length; i += 2) {
    stereo[i] = 16384;
    stereo[i + 1] = -8192;
  }
  queue.push(stereo);
  const left = new Float32Array(960),
    right = new Float32Array(960);
  queue.render(left, right);
  expect([...new Set(left)]).toEqual([0.5]);
  expect([...new Set(right)]).toEqual([-0.25]);
  queue.render(left, right);
  expect(left.every((value) => value === 0)).toBe(true);
  queue.push(new Int16Array(9600).fill(8192));
  queue.push(new Int16Array(9600).fill(16384));
  queue.render(left, right);
  expect(left.every((value) => value === 0.5)).toBe(true);
});

test("accompaniment requires isolated application audio and never falls back to whole-device capture", async () => {
  const unsupported = fixture(false);
  await expect(
    unsupported.audio.startIsolated({ mode: "window", window: "456" }),
  ).rejects.toThrow("隔离");
  expect(unsupported.launch).not.toHaveBeenCalled();
  const { audio, child, launch } = fixture();
  const started = audio.startIsolated({ mode: "window", window: "456" });
  child.stderr.write("ERROR activate-result 80004002\n");
  await expect(started).rejects.toThrow();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch.mock.calls[0]![1]).toEqual(["window", "456", "123"]);
});

test("strict process capture forwards the server-side catalog process incarnation", async () => {
  const { audio, child, launch } = fixture();
  const pending = audio.startIsolated({
    mode: "process",
    window: "456:123456789",
  });
  child.stderr.write("READY\n");
  await pending;
  expect(launch.mock.calls[0]![1]).toEqual(["process", "456:123456789", "123"]);
  audio.stop();
});
