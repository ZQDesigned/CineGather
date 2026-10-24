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
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: mock(() => true),
  });
  const launch = mock(
    (_executable: string, _args: string[], _options: unknown) =>
      child as unknown as ChildProcessWithoutNullStreams,
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
  return { audio, child, launch, packets, failed };
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
  const id = await started;
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
test("unsupported systems, absent consent, startup failure, timeout and cancel never fall back to system mix", async () => {
  const unsupported = fixture(false);
  unsupported.audio.grant({ sourceId: "screen:0:0", systemAudio: true });
  await expect(unsupported.audio.start()).rejects.toThrow("Windows");
  expect(unsupported.launch).not.toHaveBeenCalled();
  const noAudio = fixture();
  noAudio.audio.grant({ sourceId: "window:2:0", systemAudio: false });
  await expect(noAudio.audio.start()).rejects.toThrow("重新选择");
  for (const mode of ["error", "timeout", "cancel"] as const) {
    const f = fixture(true, 10);
    f.audio.grant({ sourceId: "screen:0:0", systemAudio: true });
    const promise = f.audio.start();
    const rejected = expect(promise).rejects.toThrow();
    if (mode === "error") f.child.stderr.write("ERROR initialize 80070005\r\n");
    if (mode === "cancel") f.audio.stop();
    await rejected;
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  }
});
test("a helper failure after startup notifies the active sharing session", async () => {
  const f = fixture();
  f.audio.grant({ sourceId: "window:456:0", systemAudio: true });
  const promise = f.audio.start();
  f.child.stderr.write("READY\n");
  const id = await promise;
  f.child.emit("exit", 1);
  expect(f.failed).toHaveBeenCalledWith(id, expect.stringContaining("中断"));
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
