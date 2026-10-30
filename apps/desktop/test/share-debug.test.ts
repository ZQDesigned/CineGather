import { expect, test } from "bun:test";
import {
  ShareDebugMetrics,
  type ShareDebugSample,
} from "../src/renderer/share-debug";
const track = (local: boolean, at: number) => ({
  track: "screen",
  participant: "a".repeat(64),
  source: "screen_share",
  local,
  kind: "video",
  muted: false,
  subscribed: true,
  status: "ok" as const,
  stats: [
    {
      id: "video",
      type: local ? "outbound-rtp" : "inbound-rtp",
      kind: "video",
      codecId: "codec",
      timestamp: at,
      bytesSent: at * 100,
      bytesReceived: at * 100,
      framesEncoded: at * 0.03,
      framesReceived: at * 0.03,
      framesDecoded: at * 0.025,
      packetsReceived: at * 0.1,
      packetsLost: at * 0.01,
      totalDecodeTime: at * 0.0001,
      frameWidth: 1920,
      frameHeight: 1080,
      jitter: 0.012,
      encoderImplementation: "libvpx",
    },
    { id: "codec", type: "codec", mimeType: "video/VP8" },
  ],
});
const sample = (at: number, local = false): ShareDebugSample => ({
  at,
  media: {
    state: "connected",
    watching: !local,
    tracks: [track(local, at)],
    playback: { presentedFrames: at * 0.02, frameAgeMs: 30 },
  },
});
const value = (rows: { label: string; value: string }[], key: string) =>
  rows.find((r) => r.label === key)?.value;
test("receiver shows interval receive/decode/display fps, bitrate and loss instead of lifetime totals", () => {
  const m = new ShareDebugMetrics("receiver");
  m.sample(sample(1000));
  const rows = m.sample(sample(3000)).rows;
  expect(value(rows, "接收 / 解码 / 显示")).toBe("30 / 25 / 20 fps");
  expect(value(rows, "接收码率")).toBe("0.80 Mbps");
  expect(value(rows, "丢包（本次间隔）")).toBe("9.1%");
  expect(value(rows, "网络抖动")).toBe("12 ms");
  expect(value(rows, "平均解码耗时")).toBe("4.0 ms/帧");
  expect(value(rows, "视频编码")).toBe("VP8");
});
test("browser sender separates actual encoded fps from capture targets and resolves actual codec", () => {
  const m = new ShareDebugMetrics("sender");
  const first = m.sample(sample(1000, true));
  expect(value(first.rows, "编码帧率")).toBe("未提供");
  const rows = m.sample(sample(3000, true)).rows;
  expect(value(rows, "编码帧率")).toBe("30 fps");
  expect(value(rows, "编码器")).toBe("libvpx");
  expect(value(rows, "视频编码")).toBe("VP8");
  expect(value(rows, "发送码率")).toBe("0.80 Mbps");
});
test("native sender derives output fps and bitrate using real native sample interval, never requested encoder", () => {
  const m = new ShareDebugMetrics("sender", true);
  const s = (at: number): ShareDebugSample => ({
    at,
    media: { state: "connected", watching: false, tracks: [] },
    native: {
      hostSession: "a",
      sampledAt: at,
      outputActive: true,
      encoderBackend: "nvenc",
      hardwareEncoder: true,
      configuredWidth: 1920,
      configuredHeight: 1080,
      configuredFps: 30,
      outputTotalFrames: at * 0.027,
      outputBytes: at * 200,
      encodingSkippedFrames: at * 0.001,
    },
  });
  m.sample(s(1000));
  const rows = m.sample(s(3000)).rows;
  expect(value(rows, "编码器")).toBe("NVENC（硬件）");
  expect(value(rows, "输出帧率")).toBe("27 fps");
  expect(value(rows, "发送码率")).toBe("1.60 Mbps");
  expect(value(rows, "编码跳帧（本次间隔）")).toBe("2 帧");
  expect(value(rows, "目标帧率")).toBe("30 fps");
  expect(value(rows, "输出分辨率")).toBe("1920 × 1080");
  const frozen = m.sample({ ...s(3000), at: 12000 });
  expect(frozen.stale).toBe(true);
  expect(value(frozen.rows, "输出帧率")).toBe("未提供");
});
test("missing stats, identity changes and counter reset clear rates, with no voice counters included", () => {
  const m = new ShareDebugMetrics("receiver");
  m.sample(sample(1000));
  m.sample(sample(3000));
  const next = sample(5000);
  next.media!.tracks[0]!.track = "another";
  expect(value(m.sample(next).rows, "接收 / 解码 / 显示")).toBe(
    "未提供 / 未提供 / 未提供 fps",
  );
  const absent = m.sample({ at: 7000 });
  expect(value(absent.rows, "接收码率")).toBe("未提供");
  m.sample(sample(9000));
  const reset = m.sample(sample(1000));
  expect(value(reset.rows, "接收码率")).toBe("未提供");
});
test("zero decoded frames do not manufacture an average processing time", () => {
  const m = new ShareDebugMetrics("receiver");
  const a = sample(1000),
    b = sample(3000);
  b.media!.tracks[0]!.stats[0]!.framesDecoded =
    a.media!.tracks[0]!.stats[0]!.framesDecoded;
  m.sample(a);
  expect(value(m.sample(b).rows, "平均解码耗时")).toBe("未提供");
});
test("native Mac telemetry retains the actual VideoToolbox backend", async () => {
  const { nativeDiagnosticSchema } = await import("@cinegather/contracts");
  const native = nativeDiagnosticSchema.parse({
    outputActive: true,
    encoderBackend: "videotoolbox",
    hardwareEncoder: true,
  });
  expect(
    value(
      new ShareDebugMetrics("sender", true).sample({ at: 1000, native }).rows,
      "编码器",
    ),
  ).toBe("VideoToolbox（硬件）");
});
