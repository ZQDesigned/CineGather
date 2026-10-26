import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  CaptureSelection,
  ProcessAudioPacket,
  ProcessAudioStart,
} from "@cinegather/contracts";

export const supportsProcessAudio = (release: string) => {
  const [major, , build] = release.split(".").map(Number);
  // OBS also enables process filtering on updated Windows 10 2004+;
  // activation remains the runtime check (the Microsoft sample says 20348).
  return major === 10 && Number.isInteger(build) && build! >= 19041;
};
export function audioTarget(sourceId: string) {
  const window = /^window:(\d+):\d+$/.exec(sourceId);
  if (
    window &&
    BigInt(window[1]!) > 0n &&
    BigInt(window[1]!) <= 0xffffffffffffffffn
  )
    return { mode: "window", window: window[1]! };
  if (/^screen:-?\d+:\d+$/.test(sourceId))
    return { mode: "screen", window: "0" };
  throw new Error("共享来源不可用，请重新选择");
}

export class AudioPackets {
  private pending = Buffer.alloc(0);
  push(
    chunk: Buffer,
    received: (data: Uint8Array, timestampMs: number) => void,
  ) {
    if (chunk.length + this.pending.length > 1_000_000)
      throw new Error("音频采集缓冲异常");
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 16) {
      const bytes = this.pending.readUInt32LE(0);
      if (!bytes || bytes > 192000 || bytes % 4)
        throw new Error("音频采集格式异常");
      if (this.pending.length < bytes + 16) return;
      received(
        Uint8Array.from(this.pending.subarray(16, bytes + 16)),
        Number(this.pending.readBigUInt64LE(8)) / 10000,
      );
      this.pending = this.pending.subarray(bytes + 16);
    }
  }
}

export class WindowsAudio {
  private generation = 0;
  private selected?: CaptureSelection & { expiresAt: number };
  private active?: {
    id: string;
    child: ChildProcessWithoutNullStreams;
    outstanding: Set<number>;
    reject(error: Error): void;
  };
  constructor(
    private readonly options: {
      executable: string;
      supported: boolean;
      ownerPid: number;
      data(packet: ProcessAudioPacket): void;
      failed(sessionId: string, message: string): void;
      spawn?: typeof spawn;
      timeoutMs?: number;
      arguments?(target: { mode: string; window: string }): string[];
    },
  ) {}
  grant(selection: CaptureSelection) {
    this.selected = selection.systemAudio
      ? { ...selection, expiresAt: Date.now() + 10000 }
      : undefined;
  }
  clearSelection() {
    this.selected = undefined;
  }
  acknowledge(sessionId: string, sequence: number) {
    if (this.active?.id === sessionId) this.active.outstanding.delete(sequence);
  }
  async start() {
    const selection = this.selected;
    this.stop();
    const generation = this.generation;
    if (!selection || selection.expiresAt <= Date.now())
      throw new Error("请重新选择共享来源后开启声音");
    const target = audioTarget(selection.sourceId);
    if (!this.options.supported)
      return this.attempt(target, "device", generation);
    try {
      return await this.attempt(target, "isolated", generation);
    } catch (error) {
      if (
        !(error instanceof IsolationUnavailable) ||
        generation !== this.generation
      )
        throw error;
      return this.attempt(target, "device", generation);
    }
  }
  async startIsolated(target: { mode: string; window: string }) {
    this.stop();
    if (!this.options.supported)
      throw new Error("当前系统不支持应用声音隔离，无法开启伴奏");
    return this.attempt(target, "isolated", this.generation);
  }
  private attempt(
    target: ReturnType<typeof audioTarget>,
    mode: ProcessAudioStart["mode"],
    generation: number,
  ): Promise<ProcessAudioStart> {
    if (generation !== this.generation) throw new Error("声音采集已停止");
    const child = (this.options.spawn ?? spawn)(
      this.options.executable,
      this.options.arguments?.(target) ?? [
        mode === "device" ? "device" : target.mode,
        target.window,
        String(this.options.ownerPid),
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    const id = randomUUID();
    const outstanding = new Set<number>();
    const decoder = new AudioPackets();
    let sequence = 0,
      ready = false,
      status = "";
    return new Promise<ProcessAudioStart>((resolve, reject) => {
      const timer = setTimeout(
        () => fail("音频采集启动超时，请检查系统输出设备后重试", true),
        this.options.timeoutMs ?? 7000,
      );
      const fail = (message: string, unavailable = false) => {
        if (this.active?.id !== id) return;
        this.active = undefined;
        clearTimeout(timer);
        child.kill();
        reject(
          !ready && mode === "isolated" && unavailable
            ? new IsolationUnavailable(message)
            : new Error(message),
        );
        if (ready) this.options.failed(id, message);
      };
      this.active = {
        id,
        child,
        outstanding,
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      child.on("error", () =>
        fail("无法启动应用声音采集，请重新安装客户端后重试"),
      );
      child.on("exit", () =>
        fail("声音来源已关闭或采集中断，请重新选择共享来源"),
      );
      child.stderr.on("data", (data: Buffer) => {
        status += data.toString("utf8");
        if (status.length > 4096 || status.includes("ERROR ")) {
          const stage = /^ERROR ([\w-]+) /m.exec(status)?.[1];
          const code = /^ERROR [\w-]+ ([\da-f]{8})/im
            .exec(status)?.[1]
            ?.toLowerCase();
          fail(
            mode === "device"
              ? "设备声音采集失败，请检查系统输出设备后重试"
              : "应用声音采集失败，请检查所选应用和系统版本后重试",
            code !== "80070005" &&
              code !== "800704c7" &&
              stage !== undefined &&
              [
                "activate",
                "activate-result",
                "initialize",
                "event",
                "service",
                "start",
                "timeout",
              ].includes(stage),
          );
          return;
        }
        if (!ready && /^READY\r?$/m.test(status) && this.active?.id === id) {
          ready = true;
          clearTimeout(timer);
          resolve({ sessionId: id, mode });
        }
      });
      child.stdout.on("data", (chunk: Buffer) => {
        if (this.active?.id !== id) return;
        try {
          decoder.push(chunk, (data, timestampMs) => {
            if (!ready) return;
            if (outstanding.size >= 4) return; // Drop stale audio rather than accumulate latency.
            const next = ++sequence;
            outstanding.add(next);
            this.options.data({
              sessionId: id,
              sequence: next,
              data,
              timestampMs,
            });
          });
        } catch {
          fail("音频采集格式异常，请重新开始共享");
        }
      });
    });
  }
  stop() {
    ++this.generation;
    this.selected = undefined;
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    active.reject(new Error("声音采集已停止"));
    // Terminating this dedicated process also releases WASAPI if startup or pipe I/O stalls.
    active.child.kill();
  }
}
class IsolationUnavailable extends Error {}
