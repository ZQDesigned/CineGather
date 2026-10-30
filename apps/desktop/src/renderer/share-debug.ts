import type { DiagnosticRecord, MediaDiagnostic } from "@cinegather/contracts";
export interface ShareDebugSample {
  at: number;
  media?: MediaDiagnostic;
  native?: DiagnosticRecord["native"];
}
export interface ShareDebugView {
  rows: { label: string; value: string }[];
  stale: boolean;
}
type Counters = Record<string, number | undefined>;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const text = (v: number | undefined, unit: string, digits = 0) =>
  finite(v) ? `${v.toFixed(digits)}${unit}` : "未提供";
const dimensions = (w?: number, h?: number) =>
  w && h ? `${w} × ${h}` : "未提供";
export class ShareDebugMetrics {
  private previous?: {
    key: string;
    time: number;
    seen: number;
    counters: Counters;
  };
  private last?: ShareDebugView;
  constructor(
    private role: "sender" | "receiver",
    private native = false,
  ) {}
  sample(sample: ShareDebugSample): ShareDebugView {
    const n = this.native ? sample.native : undefined;
    const track = sample.media?.tracks.find(
      (t) =>
        t.kind === "video" &&
        t.source === "screen_share" &&
        t.local === (this.role === "sender"),
    );
    const stat = track?.stats
      .filter(
        (s) =>
          s.type ===
            (this.role === "sender" ? "outbound-rtp" : "inbound-rtp") &&
          (s.kind ?? s.mediaType) !== "audio",
      )
      .filter(
        (s) =>
          !/(?:rtx|red|ulpfec)$/i.test(
            track.stats.find((c) => c.id === s.codecId)?.mimeType ?? "",
          ),
      )
      .sort(
        (a, b) =>
          (b.bytesReceived ?? b.bytesSent ?? 0) -
          (a.bytesReceived ?? a.bytesSent ?? 0),
      )[0];
    const usable = this.native
      ? Boolean(n?.outputActive)
      : Boolean(stat && track?.status === "ok");
    const time = this.native ? n?.sampledAt : stat?.timestamp;
    const key = this.native
      ? `${n?.hostSession}:${n?.captureSequence}:${n?.selectedEncoder}`
      : `${track?.track}:${stat?.id}`;
    const old = this.previous;
    const stale = Boolean(
      usable &&
        ((this.native && finite(time) && sample.at - time > 7000) ||
          (old?.key === key &&
            time === old.time &&
            sample.at - old.seen > 7000)),
    );
    if (usable && !stale && old?.key === key && time === old.time && this.last)
      return this.last;
    const counters: Counters = this.native
      ? {
          frames: n?.outputTotalFrames,
          bytes: n?.outputBytes,
          skipped: n?.encodingSkippedFrames,
          renderSkipped: n?.renderSkippedFrames,
          outputSkipped: n?.outputSkippedFrames,
          capture: n?.captureCopiedFrames,
        }
      : {
          frames: stat?.framesEncoded,
          bytes: this.role === "sender" ? stat?.bytesSent : stat?.bytesReceived,
          received: stat?.framesReceived,
          decoded: stat?.framesDecoded,
          packets: stat?.packetsReceived,
          lost: stat?.packetsLost,
          decodeTime: stat?.totalDecodeTime,
          encodeTime: stat?.totalEncodeTime,
          shown:
            sample.media?.playback?.presentedFrames ??
            sample.media?.playback?.callbackCount ??
            (finite(sample.media?.playback?.totalFrames)
              ? sample.media.playback.totalFrames -
                (sample.media.playback.droppedFrames ?? 0)
              : undefined),
          dropped: sample.media?.playback?.droppedFrames,
        };
    const dt = finite(time) && old?.key === key ? time - old.time : 0;
    const reset = Object.entries(counters).some(
      ([k, v]) =>
        k !== "lost" &&
        finite(v) &&
        finite(old?.counters[k]) &&
        v < old!.counters[k]!,
    );
    const interval = usable && !stale && !reset && dt >= 500 && dt <= 6500;
    const delta = (key: string) =>
      interval && finite(counters[key]) && finite(old?.counters[key])
        ? Math.max(0, counters[key]! - old!.counters[key]!)
        : undefined;
    const rate = (key: string) => {
      const v = delta(key);
      return v === undefined ? undefined : (v * 1000) / dt;
    };
    this.previous =
      usable && !stale && finite(time)
        ? { key, time, seen: sample.at, counters }
        : undefined;
    const rows: ShareDebugView["rows"] = [];
    const row = (label: string, value: string) => rows.push({ label, value });
    const codec = track?.stats
      .find((c) => c.id === stat?.codecId)
      ?.mimeType?.replace(/^video\//i, "");
    row(
      "视频编码",
      this.native
        ? n?.encoderBackend
          ? "H264"
          : "未提供"
        : (codec ?? "未提供"),
    );
    if (this.role === "sender") {
      const backend = n?.encoderBackend
        ? (
            {
              nvenc: "NVENC",
              amf: "AMF",
              x264: "x264",
              videotoolbox: "VideoToolbox",
            } as const
          )[n.encoderBackend]
        : undefined;
      row(
        "编码器",
        this.native
          ? backend
            ? backend +
              (n?.hardwareEncoder === true
                ? "（硬件）"
                : n?.hardwareEncoder === false
                  ? "（软件）"
                  : "")
            : "未提供"
          : (stat?.encoderImplementation ?? "未提供"),
      );
      row(
        "输出分辨率",
        this.native
          ? dimensions(n?.configuredWidth, n?.configuredHeight)
          : dimensions(stat?.frameWidth, stat?.frameHeight),
      );
      if (this.native) row("目标帧率", text(n?.configuredFps, " fps"));
      row(this.native ? "输出帧率" : "编码帧率", text(rate("frames"), " fps"));
      row(
        "发送码率",
        text(
          rate("bytes") === undefined ? undefined : (rate("bytes")! * 8) / 1e6,
          " Mbps",
          2,
        ),
      );
      if (this.native) {
        row("采集帧率", text(rate("capture"), " fps"));
        row("编码跳帧（本次间隔）", text(delta("skipped"), " 帧"));
        row("渲染跳帧（本次间隔）", text(delta("renderSkipped"), " 帧"));
        row("发送丢帧（本次间隔）", text(delta("outputSkipped"), " 帧"));
      } else {
        const limitation: Record<string, string> = {
          none: "无",
          cpu: "CPU",
          bandwidth: "带宽",
          other: "其他",
        };
        row(
          "质量受限原因",
          limitation[stat?.qualityLimitationReason ?? ""] ?? "未提供",
        );
        const frames = delta("frames"),
          encodeTime = delta("encodeTime");
        row(
          "平均编码耗时",
          text(
            frames !== undefined && frames > 0 && encodeTime !== undefined
              ? (encodeTime / frames) * 1000
              : undefined,
            " ms/帧",
            1,
          ),
        );
      }
    } else {
      row("接收分辨率", dimensions(stat?.frameWidth, stat?.frameHeight));
      row(
        "接收 / 解码 / 显示",
        [rate("received"), rate("decoded"), rate("shown")]
          .map((v) => text(v, ""))
          .join(" / ") + " fps",
      );
      row(
        "接收码率",
        text(
          rate("bytes") === undefined ? undefined : (rate("bytes")! * 8) / 1e6,
          " Mbps",
          2,
        ),
      );
      const packets = delta("packets"),
        lost = delta("lost");
      row(
        "丢包（本次间隔）",
        text(
          packets !== undefined && lost !== undefined && packets + lost > 0
            ? (lost / (packets + lost)) * 100
            : undefined,
          "%",
          1,
        ),
      );
      row(
        "网络抖动",
        text(finite(stat?.jitter) ? stat.jitter * 1000 : undefined, " ms"),
      );
      const decoded = delta("decoded"),
        decodeTime = delta("decodeTime");
      row(
        "平均解码耗时",
        text(
          decoded !== undefined && decoded > 0 && decodeTime !== undefined
            ? (decodeTime / decoded) * 1000
            : undefined,
          " ms/帧",
          1,
        ),
      );
      row("播放丢帧（本次间隔）", text(delta("dropped"), " 帧"));
      row("距上一帧", text(sample.media?.playback?.frameAgeMs, " ms"));
      row("解码器", stat?.decoderImplementation ?? "未提供");
    }
    return (this.last = { rows, stale });
  }
}
