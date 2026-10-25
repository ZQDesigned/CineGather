import { zip, strToU8 } from "fflate";
import {
  diagnosticRetentionMs,
  qualityPresets,
  diagnosticRecordSchema,
  type DiagnosticRecord,
} from "@cinegather/contracts";
export interface DiagnosticInterval {
  at: number;
  session: string;
  room?: string;
  track: string;
  participant: string;
  source: string;
  type: string;
  local: boolean;
  durationMs: number;
  reset: boolean;
  gap: boolean;
  bitrateBps?: number;
  fps?: number;
  lostPackets?: number;
  freezeCount?: number;
  freezeSeconds?: number;
  jitterMs?: number;
  bufferMs?: number;
  decodeMs?: number;
  encodeMs?: number;
  nackCount?: number;
  droppedFrames?: number;
  rttMs?: number;
  qualityLimitation?: string;
  encoderImplementation?: string;
  encoderMode?: "hardware" | "software" | "unknown";
}
export function encoderMode(stat?: {
  powerEfficientEncoder?: boolean;
  encoderImplementation?: string;
}) {
  if (stat?.powerEfficientEncoder === true) return "hardware" as const;
  if (
    stat?.powerEfficientEncoder === false ||
    /OpenH264|libvpx|libaom/i.test(stat?.encoderImplementation ?? "")
  )
    return "software" as const;
  return "unknown" as const;
}
export function summarizeDiagnostics(entries: DiagnosticRecord[]) {
  const failures = new Map<
    string,
    {
      stage: string;
      code: string;
      field?: string;
      count: number;
      firstAt: number;
      lastAt: number;
    }
  >();
  for (const entry of entries)
    for (const issue of [
      ...(entry.issues ?? []),
      ...(entry.media?.issues ?? []),
    ]) {
      const key = [issue.stage, issue.code, issue.field].join(":");
      const old = failures.get(key);
      if (old) {
        old.count++;
        old.lastAt = entry.at;
      } else
        failures.set(key, {
          ...issue,
          count: 1,
          firstAt: entry.at,
          lastAt: entry.at,
        });
    }
  const previous = new Map<
    string,
    { at: number; monotonicMs: number; stat: Record<string, unknown> }
  >();
  const intervals: DiagnosticInterval[] = [];
  const number = (object: Record<string, unknown>, key: string) =>
    typeof object[key] === "number" ? (object[key] as number) : undefined;
  for (const entry of entries)
    for (const track of entry.media?.tracks ?? [])
      for (const stat of track.stats) {
        if (!["inbound-rtp", "outbound-rtp"].includes(String(stat.type)))
          continue;
        const key = [
          entry.session,
          entry.room,
          track.track,
          track.local,
          stat.id,
          stat.ssrc,
          stat.type,
        ].join(":");
        const old = previous.get(key);
        previous.set(key, {
          at: entry.at,
          monotonicMs: entry.monotonicMs,
          stat,
        });
        if (!old) continue;
        const dt =
          number(stat, "timestamp") !== undefined &&
          number(old.stat, "timestamp") !== undefined
            ? number(stat, "timestamp")! - number(old.stat, "timestamp")!
            : entry.monotonicMs - old.monotonicMs;
        const elapsed = entry.at - old.at;
        const delta = (field: string) => {
          const a = number(stat, field),
            b = number(old.stat, field);
          return a === undefined || b === undefined ? undefined : a - b;
        };
        const reset =
          dt <= 0 ||
          ["bytesReceived", "bytesSent", "framesDecoded", "framesEncoded"].some(
            (key) => (delta(key) ?? 0) < 0,
          );
        const gap = elapsed > 7500 || dt > 7500;
        const interval: DiagnosticInterval = {
          at: entry.at,
          session: entry.session,
          room: entry.room,
          track: track.track,
          participant: track.participant,
          source: track.source,
          type: String(stat.type),
          local: track.local,
          durationMs: dt,
          reset,
          gap,
        };
        if (!reset && !gap) {
          const bytes = delta(
            stat.type === "inbound-rtp" ? "bytesReceived" : "bytesSent",
          );
          const frames = delta(
            stat.type === "inbound-rtp" ? "framesDecoded" : "framesEncoded",
          );
          if (bytes !== undefined) interval.bitrateBps = (bytes * 8000) / dt;
          if (frames !== undefined) interval.fps = (frames * 1000) / dt;
          interval.lostPackets = delta("packetsLost");
          interval.freezeCount = delta("freezeCount");
          interval.freezeSeconds = delta("totalFreezesDuration");
          interval.nackCount = delta("nackCount");
          interval.droppedFrames = delta("framesDropped");
          const buffer = delta("jitterBufferDelay"),
            emitted = delta("jitterBufferEmittedCount");
          if (buffer !== undefined && emitted && emitted > 0)
            interval.bufferMs = (buffer * 1000) / emitted;
          const decode = delta("totalDecodeTime"),
            encode = delta("totalEncodeTime");
          if (frames && frames > 0) {
            if (decode !== undefined)
              interval.decodeMs = (decode * 1000) / frames;
            if (encode !== undefined)
              interval.encodeMs = (encode * 1000) / frames;
          }
        }
        if (number(stat, "jitter") !== undefined)
          interval.jitterMs = number(stat, "jitter")! * 1000;
        if (number(stat, "roundTripTime") !== undefined)
          interval.rttMs = number(stat, "roundTripTime")! * 1000;
        if (typeof stat.qualityLimitationReason === "string")
          interval.qualityLimitation = stat.qualityLimitationReason;
        if (stat.type === "outbound-rtp") {
          interval.encoderImplementation = stat.encoderImplementation;
          interval.encoderMode = encoderMode(stat);
        }
        intervals.push(interval);
      }
  const coverage = [...new Set(entries.map((entry) => entry.session))].map(
    (session) => {
      const samples = entries.filter(
        (entry) =>
          entry.session === session &&
          ["sample", "resources"].includes(entry.kind),
      );
      const gaps = samples.flatMap((sample, index) =>
        index && sample.at - samples[index - 1]!.at > 25000
          ? [
              {
                from: samples[index - 1]!.at,
                until: sample.at,
                durationMs: sample.at - samples[index - 1]!.at,
              },
            ]
          : [],
      );
      return {
        session,
        since: samples[0]?.at,
        until: samples.at(-1)?.at,
        samples: samples.length,
        gaps,
      };
    },
  );
  return {
    intervals,
    summary: {
      records: entries.length,
      collectionIssues: [...failures.values()],
      coverage,
      since: entries[0]?.at,
      until: entries.at(-1)?.at,
      sessions: [...new Set(entries.map((x) => x.session))],
      rooms: [...new Set(entries.flatMap((x) => (x.room ? [x.room] : [])))],
      sampleGaps: entries.filter((x) => x.kind === "gap").length,
      unavailableTrackReports: entries
        .flatMap((x) => x.media?.tracks ?? [])
        .filter((x) => x.subscribed && x.status !== "ok").length,
      markers: entries
        .filter((x) => x.kind === "marker")
        .map((x) => ({ at: x.at, session: x.session, room: x.room })),
      evidence: intervals
        .filter(
          (x) =>
            (x.freezeCount ?? 0) > 0 ||
            (x.lostPackets ?? 0) > 0 ||
            (x.bufferMs ?? 0) > 150 ||
            (x.decodeMs ?? 0) > 25 ||
            (x.encodeMs ?? 0) > 25 ||
            ["cpu", "bandwidth"].includes(x.qualityLimitation ?? ""),
        )
        .slice(-500),
      limitations: [
        "Correlate sender and viewer packages by hashed room, participant and track SID. One endpoint alone cannot always distinguish SFU forwarding from the network path.",
        "Collection issues identify sanitized stage/code/schema-field paths. Partial samples preserve valid fields; hardware mode is confirmed by powerEfficientEncoder, not by enabling a feature flag. Unknown mode does not imply hardware. Raw exceptions are never exported.",
        "No media is recorded. An unchanged source image is not proof of a capture freeze. Missing/unsupported stats are absent, never fabricated as zero.",
        "UTC alignment uses server midpoint offsets with half-RTT uncertainty when available. WebRTC timestamps are local clocks; rates use differences only.",
        "Freeze, jitter-buffer and processing durations are seconds in raw WebRTC stats; derived interval units are explicit. Counters reset on reconnect; no rates span gaps or resets.",
      ],
    },
  };
}
export function framePipeline(
  entries: DiagnosticRecord[],
  intervals: DiagnosticInterval[],
) {
  const previous = new Map<
    string,
    { at: number; framesReceived?: number; presentedFrames?: number }
  >();
  const indexed = new Map(
    intervals.map((interval) => [
      [interval.session, interval.at, interval.track].join(":"),
      interval,
    ]),
  );
  return entries.flatMap((entry) =>
    (entry.media?.tracks ?? [])
      .filter((track) => track.kind === "video")
      .map((track) => {
        const stat = track.stats.find(
          (stat) =>
            stat.type === (track.local ? "outbound-rtp" : "inbound-rtp"),
        );
        const source = track.stats.find((stat) => stat.type === "media-source");
        const key = [entry.session, entry.room, track.track].join(":");
        const old = previous.get(key),
          dt = old ? entry.monotonicMs - old.at : 0;
        const playback = entry.media?.playback;
        const currentFrames =
          typeof stat?.framesReceived === "number"
            ? stat.framesReceived
            : undefined;
        const interval = indexed.get(
          [entry.session, entry.at, track.track].join(":"),
        );
        const presented = playback?.presentedFrames;
        previous.set(key, {
          at: entry.monotonicMs,
          framesReceived: currentFrames,
          presentedFrames: presented,
        });
        const rate = (current?: number, previous?: number) =>
          dt > 0 &&
          dt <= 7500 &&
          current !== undefined &&
          previous !== undefined &&
          current >= previous
            ? ((current - previous) * 1000) / dt
            : undefined;
        const preset =
          track.local && entry.context
            ? qualityPresets[entry.context.quality]
            : undefined;
        return {
          at: entry.at,
          session: entry.session,
          room: entry.room,
          track: track.track,
          participant: track.participant,
          role: track.local ? "sender" : "viewer",
          watching: entry.context?.watching,
          hidden: entry.context?.hidden,
          targetWidth: preset?.width,
          targetHeight: preset?.height,
          targetFps: preset?.frameRate,
          captureSettingFps: track.settings?.frameRate,
          sourceFps: source?.framesPerSecond,
          width: stat?.frameWidth,
          height: stat?.frameHeight,
          encodedFps: track.local ? interval?.fps : undefined,
          receivedFps: rate(currentFrames, old?.framesReceived),
          decodedFps: track.local ? undefined : interval?.fps,
          presentedFps: rate(presented, old?.presentedFrames),
          maxFrameGapMs: playback?.maxFrameGapMs,
          frameAgeMs: playback?.frameAgeMs,
          bufferMs: interval?.bufferMs,
          decodeMs: interval?.decodeMs,
          encodeMs: interval?.encodeMs,
          qualityLimitation: interval?.qualityLimitation,
          reportStatus: track.status,
          encoderImplementation: stat?.encoderImplementation,
          encoderMode: track.local ? encoderMode(stat) : undefined,
        };
      }),
  );
}
export function nativePipeline(entries: DiagnosticRecord[]) {
  const previous = new Map<
    string,
    {
      at: number;
      frames?: number;
      bytes?: number;
      arrived?: number;
      copied?: number;
      active?: boolean;
    }
  >();
  return entries.flatMap((entry) => {
    const native = entry.native;
    if (!native) return [];
    const key = [
      entry.session,
      native.hostSession,
      native.captureSequence,
      native.selectedEncoder,
    ].join(":");
    const old = previous.get(key),
      sampleTime = native.sampledAt ?? entry.monotonicMs,
      dt = old ? sampleTime - old.at : 0;
    const reset = Boolean(
      old &&
        native.outputTotalFrames !== undefined &&
        old.frames !== undefined &&
        native.outputTotalFrames < old.frames,
    );
    const rate = (current?: number, last?: number) =>
      !reset &&
      native.outputActive &&
      old?.active &&
      dt > 0 &&
      dt <= 15000 &&
      current !== undefined &&
      last !== undefined &&
      current >= last
        ? ((current - last) * 1000) / dt
        : undefined;
    const encodedFps = rate(native.outputTotalFrames, old?.frames),
      bytesPerSecond = rate(native.outputBytes, old?.bytes);
    previous.set(key, {
      at: sampleTime,
      active: native.outputActive,
      frames: native.outputTotalFrames,
      bytes: native.outputBytes,
      arrived: native.captureArrivedFrames,
      copied: native.captureCopiedFrames,
    });
    return [
      {
        at: entry.at,
        session: entry.session,
        sampledAt: native.sampledAt,
        hostSession: native.hostSession,
        outputPhase: native.outputPhase,
        transportPhase: native.transportPhase,
        transportFailure: native.transportFailure,
        transportErrorCode: native.transportErrorCode,
        transportHttpStatus: native.transportHttpStatus,
        hostExitCode: native.hostExitCode,
        hostExitReason: native.hostExitReason,
        hostEventAt: native.hostEventAt,
        captureSequence: native.captureSequence,
        graphicsAdapterIndex: native.graphicsAdapterIndex,
        graphicsVendorId: native.graphicsVendorId,
        graphicsDeviceId: native.graphicsDeviceId,
        graphicsAdapterVerified: native.graphicsAdapterVerified,
        selectedEncoder: native.selectedEncoder,
        requestedEncoder: native.requestedEncoder,
        encoderBackend: native.encoderBackend,
        encoderMode:
          native.hardwareEncoder === true
            ? "hardware"
            : native.hardwareEncoder === false
              ? "software"
              : "unknown",
        targetWidth: native.configuredWidth,
        targetHeight: native.configuredHeight,
        targetFps: native.configuredFps,
        sourceWidth: native.sourceWidth,
        sourceHeight: native.sourceHeight,
        captureArrivalFps: rate(native.captureArrivedFrames, old?.arrived),
        capturedFps: rate(native.captureCopiedFrames, old?.copied),
        captureAgeMs: native.captureAgeMs,
        captureCountersAvailable: native.captureCountersAvailable,
        renderFps: native.activeFps,
        encodedFps,
        bitrateBps:
          bytesPerSecond === undefined ? undefined : bytesPerSecond * 8,
        outputSkippedFrames: native.outputSkippedFrames,
        renderSkippedFrames: native.renderSkippedFrames,
        averageRenderTimeMs:
          native.averageFrameRenderTime === undefined
            ? undefined
            : native.averageFrameRenderTime / 1e6,
        audioFramesCaptured: native.audioFramesCaptured,
        audioCaptureDelayMs: native.audioCaptureDelayMs,
        audioTimestampFallbacks: native.audioTimestampFallbacks,
        reset,
      },
    ];
  });
}
function csv(rows: Record<string, unknown>[], columns: string[]) {
  return [
    columns.join(","),
    ...rows.map((row) =>
      columns
        .map((key) =>
          typeof row[key] === "number" || typeof row[key] === "boolean"
            ? String(row[key])
            : `"${String(row[key] ?? "")
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""')}"`,
        )
        .join(","),
    ),
  ].join("\n");
}
const guide = `CineGather 诊断包（格式 v1）\n\nsummary.json 的 collectionIssues 汇总采样失败的阶段、分类、字段和发生时间，降级时其余有效数据继续保留。frame-pipeline.csv 的 encoderImplementation/encoderMode 是实际运行结果；manifest.encodingPolicy 仅说明启动策略，不能据此认定已使用硬件编码。\n\n先阅读 manifest.json 的时间范围、缺口和能力说明，再检查 summary.json 的问题标记及异常区间。timeline.ndjson 包含逐条原始白名单记录；intervals.csv 是按轨道计算的区间码率、帧率、丢包、冻结、解码和缓冲指标。current.json 是导出时快照。frame-pipeline.csv 对照目标、实际采集、编码、接收、解码与呈现帧率；目标值只用于发送端，观看端的本机画质设置不能代表共享端目标。静态内容可能主动降帧，判断异常应对照持续运动画面。\n\n共享端和观看端请分别导出同一次问题的包。通过 room 哈希、participant 哈希、track SID 关联；session 是每次应用启动随机生成的会话标识。at 是 UTC 毫秒，monotonicMs 是该进程单调时钟。server.capturedAt 与 request.clockOffsetMs/clockUncertaintyMs 用于对齐两端时钟，误差至少为半个请求往返时间。\n\n优先排查：发送端 media-source/编码帧率及质量限制 → 发送码率/重传/远端接收报告 → 服务器 CPU/内存/SFU 转发与丢包 → 接收帧率/丢包/缓冲/解码 → 视频呈现回调间隔/掉帧及渲染线程长任务。对照 resources 中 GPU/渲染进程负载。native 是 macOS/Windows 原生采集宿主的安全计数器。native-pipeline.csv 列出原生输出计数器计算的编码帧率、码率和渲染耗时；renderFps 是渲染循环速率，不代表来源实际产生的画面帧率。captureArrivalFps 是 WGC 到达帧率，capturedFps 是成功拷贝到 OBS 的新帧率；静态画面更新较少仍可能是正常行为。Windows manifest.nativeEncoder 包含显卡、编码器清单、最后一次真实共享状态，以及导出时的合成画面编码自检。lastSession 与 probe 必须区分：后者不代表先前真实共享使用的编码器。手动选择失败不会自动回退，encoderAttempts/encoderErrors 记录尝试、阶段和已脱敏的错误码。没有完整编码能力列表时 profilesReported=false，不能解读为显卡不支持硬编码。\n\n记录仅覆盖应用实际运行时段；退出、休眠、浏览器后台节流、采样失败、磁盘故障或容量限制均可能导致缺口，不能据此声称连续一小时无异常。默认滚动保留两小时，不含音视频、截图、聊天内容、账号凭据、原始用户ID、IP地址、窗口标题、完整SDP或原始第三方日志。服务器指标未启用/旧服务端会明确标为不可用。不能仅凭单端数据保证唯一归因，更不能恢复真实音视频内容。\n`;
export async function diagnosticArchive(
  entries: DiagnosticRecord[],
  metadata: Record<string, unknown>,
  current: unknown,
) {
  const safe = entries
    .map((x) => diagnosticRecordSchema.parse(x))
    .sort((a, b) => a.at - b.at || a.sequence - b.sequence);
  const { intervals, summary } = summarizeDiagnostics(safe);
  const pipeline = framePipeline(safe, intervals);
  const columns: (keyof DiagnosticInterval)[] = [
    "at",
    "session",
    "room",
    "participant",
    "track",
    "source",
    "local",
    "type",
    "durationMs",
    "reset",
    "gap",
    "bitrateBps",
    "fps",
    "lostPackets",
    "freezeCount",
    "freezeSeconds",
    "jitterMs",
    "bufferMs",
    "decodeMs",
    "encodeMs",
    "nackCount",
    "droppedFrames",
    "rttMs",
    "qualityLimitation",
    "encoderImplementation",
    "encoderMode",
  ];
  const files = {
    "manifest.json": strToU8(
      JSON.stringify(
        {
          format: "cinegather-diagnostics",
          schemaVersion: 1,
          exportedAt: Date.now(),
          retentionMs: diagnosticRetentionMs,
          ...metadata,
          coverage: {
            since: summary.since,
            until: summary.until,
            wallSpanMs:
              summary.until !== undefined && summary.since !== undefined
                ? summary.until - summary.since
                : 0,
            records: safe.length,
          },
          privacy: {
            media: false,
            rawLogs: false,
            credentials: false,
            ipAddresses: false,
          },
        },
        null,
        2,
      ),
    ),
    "summary.json": strToU8(JSON.stringify(summary, null, 2)),
    "current.json": strToU8(JSON.stringify(current, null, 2)),
    "timeline.ndjson": strToU8(
      safe.map((x) => JSON.stringify(x)).join("\n") + "\n",
    ),
    "native-pipeline.csv": strToU8(
      csv(nativePipeline(safe), [
        "at",
        "session",
        "sampledAt",
        "hostSession",
        "outputPhase",
        "transportPhase",
        "transportFailure",
        "transportErrorCode",
        "transportHttpStatus",
        "hostExitCode",
        "hostExitReason",
        "hostEventAt",
        "captureSequence",
        "graphicsAdapterIndex",
        "graphicsVendorId",
        "graphicsDeviceId",
        "graphicsAdapterVerified",
        "selectedEncoder",
        "requestedEncoder",
        "encoderBackend",
        "encoderMode",
        "targetWidth",
        "targetHeight",
        "targetFps",
        "sourceWidth",
        "sourceHeight",
        "captureArrivalFps",
        "capturedFps",
        "captureAgeMs",
        "captureCountersAvailable",
        "renderFps",
        "encodedFps",
        "bitrateBps",
        "outputSkippedFrames",
        "renderSkippedFrames",
        "averageRenderTimeMs",
        "audioFramesCaptured",
        "audioCaptureDelayMs",
        "audioTimestampFallbacks",
        "reset",
      ]),
    ),
    "intervals.csv": strToU8(
      csv(intervals as unknown as Record<string, unknown>[], columns),
    ),
    "frame-pipeline.csv": strToU8(
      csv(
        pipeline,
        Object.keys(
          pipeline[0] ?? {
            at: 0,
            role: "",
            targetFps: 0,
            sourceFps: 0,
            encodedFps: 0,
            receivedFps: 0,
            decodedFps: 0,
            presentedFps: 0,
          },
        ),
      ),
    ),
    "README.txt": strToU8(guide),
  };
  return new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 3 }, (error, data) =>
      error ? reject(error) : resolve(data),
    ),
  );
}
