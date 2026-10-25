import { z } from "zod";
import { nativeEncoderIdSchema } from "./native-encoders";
import {
  senderDiagnosticSchema,
  encoderCapabilitiesSchema,
  gpuDiagnosticSchema,
} from "./encoder-diagnostics";

export const diagnosticRetentionMs = 2 * 60 * 60 * 1000;
export const diagnosticRecordLimit = 48 * 1024;
const number = z.number().finite();
const fields = <T extends readonly string[], S extends z.ZodType>(
  keys: T,
  schema: S,
) =>
  Object.fromEntries(keys.map((key) => [key, schema])) as {
    [K in T[number]]: S;
  };
const text = z
  .string()
  .max(160)
  .transform((value) =>
    /(?:https?:\/\/|wss?:\/\/|Bearer\s|eyJ[A-Za-z0-9_-]+\.)/i.test(value)
      ? "[redacted]"
      : value,
  );
export const diagnosticIssueSchema = z.object({
  stage: z.enum([
    "rtc",
    "playback",
    "track",
    "media",
    "renderer",
    "resources",
    "native",
    "record",
    "storage",
  ]),
  code: z.enum([
    "invalid-number",
    "invalid-field",
    "read-failed",
    "timeout",
    "unavailable",
    "sample-failed",
    "storage-failed",
    "permission-denied",
    "no-space",
    "io-failed",
    "queue-full",
    "truncated",
  ]),
  // Fixed schema paths only; never exception messages, values, or identities.
  field: z
    .string()
    .max(160)
    .regex(/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/)
    .optional(),
});
export type DiagnosticIssue = z.infer<typeof diagnosticIssueSchema>;
const diagnosticIssues = z.array(diagnosticIssueSchema).max(64).optional();

// For trusted telemetry producers. Each whitelisted getter/field is independent;
// IPC/storage still use the strict schema after this projection.
export function projectDiagnosticObject<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
  input: object,
  stage: DiagnosticIssue["stage"],
  prefix: string,
  issue: (value: DiagnosticIssue) => void,
): z.infer<z.ZodObject<S>> {
  const result: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(schema.shape)) {
    const field = `${prefix}.${key}`;
    try {
      const value = (input as Record<string, unknown>)[key];
      const parsed = (validator as z.ZodType).safeParse(value);
      if (parsed.success) {
        if (parsed.data !== undefined) result[key] = parsed.data;
      } else
        issue({
          stage,
          code:
            typeof value === "number" && !Number.isFinite(value)
              ? "invalid-number"
              : "invalid-field",
          field,
        });
    } catch {
      issue({ stage, code: "read-failed", field });
    }
  }
  return schema.parse(result);
}

export const rtcNumbers = [
  "timestamp",
  "ssrc",
  "bytesReceived",
  "bytesSent",
  "headerBytesReceived",
  "headerBytesSent",
  "packetsReceived",
  "packetsSent",
  "packetsLost",
  "jitter",
  "framesPerSecond",
  "framesReceived",
  "framesDecoded",
  "framesEncoded",
  "framesSent",
  "framesDropped",
  "frameWidth",
  "frameHeight",
  "keyFramesDecoded",
  "keyFramesEncoded",
  "freezeCount",
  "totalFreezesDuration",
  "pauseCount",
  "totalPausesDuration",
  "totalDecodeTime",
  "totalEncodeTime",
  "totalInterFrameDelay",
  "totalSquaredInterFrameDelay",
  "jitterBufferDelay",
  "jitterBufferTargetDelay",
  "jitterBufferMinimumDelay",
  "jitterBufferEmittedCount",
  "totalProcessingDelay",
  "totalAssemblyTime",
  "framesAssembledFromMultiplePackets",
  "totalPacketSendDelay",
  "targetBitrate",
  "nackCount",
  "pliCount",
  "firCount",
  "retransmittedPacketsSent",
  "retransmittedBytesSent",
  "fecPacketsReceived",
  "fecPacketsDiscarded",
  "packetsDiscarded",
  "concealedSamples",
  "silentConcealedSamples",
  "totalSamplesReceived",
  "totalSamplesDuration",
  "audioLevel",
  "totalAudioEnergy",
  "insertedSamplesForDeceleration",
  "removedSamplesForAcceleration",
  "roundTripTime",
  "totalRoundTripTime",
  "roundTripTimeMeasurements",
  "fractionLost",
  "currentRoundTripTime",
  "availableOutgoingBitrate",
  "availableIncomingBitrate",
  "requestsSent",
  "responsesReceived",
  "consentRequestsSent",
  "lastPacketReceivedTimestamp",
  "lastPacketSentTimestamp",
  "packetsDiscardedOnSend",
  "bytesDiscardedOnSend",
  "remoteTimestamp",
  "estimatedPlayoutTimestamp",
  "frames",
  "width",
  "height",
  "clockRate",
  "channels",
] as const;
export const rtcStrings = [
  "id",
  "type",
  "kind",
  "mediaType",
  "codecId",
  "transportId",
  "localId",
  "remoteId",
  "mimeType",
  "sdpFmtpLine",
  "state",
  "qualityLimitationReason",
  "encoderImplementation",
  "decoderImplementation",
  "dtlsState",
  "iceState",
  "selectedCandidatePairId",
  "localCandidateType",
  "remoteCandidateType",
  "transportProtocol",
  "relayProtocol",
] as const;
export const rtcStatSchema = z.object({
  ...fields(rtcNumbers, number.optional()),
  ...fields(rtcStrings, text.optional()),
  qualityLimitationDurations: z
    .object({
      none: number.optional(),
      cpu: number.optional(),
      bandwidth: number.optional(),
      other: number.optional(),
    })
    .optional(),
  nominated: z.boolean().optional(),
  powerEfficientEncoder: z.boolean().optional(),
  powerEfficientDecoder: z.boolean().optional(),
});
export type DiagnosticStat = z.infer<typeof rtcStatSchema>;
export const playbackSchema = z
  .object({
    clientWidth: number.optional(),
    clientHeight: number.optional(),
    readyState: number,
    paused: z.boolean(),
    ended: z.boolean(),
    hidden: z.boolean(),
    width: number,
    height: number,
    currentTime: number,
    playbackRate: number,
    totalFrames: number.optional(),
    droppedFrames: number.optional(),
    presentedFrames: number.optional(),
    frameAgeMs: number.optional(),
    maxFrameGapMs: number.optional(),
    callbackCount: number.optional(),
    processingDuration: number.optional(),
    presentationDelayMs: number.optional(),
    expectedDisplayDelayMs: number.optional(),
    captureToReceiveMs: number.optional(),
    receiveToPresentMs: number.optional(),
    mediaTime: number.optional(),
  })
  .partial();
const microphoneNoiseSchema = z.object({
  requested: z.enum(["enhanced", "basic", "off"]),
  active: z.enum(["enhanced", "basic", "off"]),
  fallback: z.boolean().optional(),
});
export const mediaDiagnosticSchema = z.object({
  encoderCapabilities: encoderCapabilitiesSchema.optional(),
  issues: diagnosticIssues,
  microphoneNoise: microphoneNoiseSchema.optional(),
  state: text,
  watching: z.boolean(),
  tracks: z
    .array(
      z.object({
        track: text,
        participant: z.string().regex(/^[a-f0-9]{64}$/),
        source: text,
        local: z.boolean(),
        kind: text,
        muted: z.boolean(),
        subscribed: z.boolean(),
        sender: senderDiagnosticSchema.optional(),
        streamState: text.optional(),
        videoQuality: number.optional(),
        enabled: z.boolean().optional(),
        settings: z
          .object({
            width: number.optional(),
            height: number.optional(),
            frameRate: number.optional(),
            sampleRate: number.optional(),
            channelCount: number.optional(),
            echoCancellation: z.boolean().optional(),
            noiseSuppression: z.boolean().optional(),
            autoGainControl: z.boolean().optional(),
            displaySurface: text.optional(),
          })
          .optional(),
        status: z.enum(["ok", "unavailable", "timeout", "failed"]),
        stats: z.array(rtcStatSchema).max(32),
      }),
    )
    .max(40),
  playback: playbackSchema.optional(),
});
export const diagnosticServerSchema = z.object({
  sampledAt: number.optional(),
  capturedAt: number.optional(),
  uptimeSeconds: number.optional(),
  requests: number.optional(),
  errors: number.optional(),
  authDenied: number.optional(),
  tokenIssueFailures: number.optional(),
  averageDurationMs: number.optional(),
  activeRooms: number.optional(),
  cpuPercent: number.optional(),
  freeMemory: number.optional(),
  totalMemory: number.optional(),
  load1: number.optional(),
  processRss: number.optional(),
  network: z
    .object({
      udpInErrors: number.optional(),
      udpReceiveBufferErrors: number.optional(),
      udpSendBufferErrors: number.optional(),
      tcpRetransmittedSegments: number.optional(),
    })
    .optional(),
  sfuStatus: z.enum(["available", "unconfigured", "unavailable"]).optional(),
  // Only fixed metric names and enum labels are accepted by the API parser.
  sfu: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^livekit_[a-z_]+$/)
          .max(96),
        direction: z.enum(["incoming", "outgoing"]).optional(),
        transmission: z.enum(["initial", "retransmit"]).optional(),
        type: z.enum(["out", "dropped"]).optional(),
        value: number,
      }),
    )
    .max(128)
    .optional(),
});
export const nativeNumbers = [
  "captureSequence",
  "configuredWidth",
  "configuredHeight",
  "configuredFps",
  "audioFramesCaptured",
  "audioCaptureDelayMs",
  "audioTimestampFallbacks",
  "activeFps",
  "averageFrameRenderTime",
  "encodingSkippedFrames",
  "renderTotalFrames",
  "renderSkippedFrames",
  "sourceWidth",
  "sourceHeight",
  "outputStopCode",
  "outputTotalFrames",
  "outputSkippedFrames",
  "outputBytes",
  "outputCongestion",
  "audioBlocks",
  "audioPeak",
  "nativeAllocationCount",
] as const;
export const nativeDiagnosticSchema = z.object({
  transportFailure: z
    .enum([
      "none",
      "http-request",
      "http-status",
      "empty-answer",
      "resource-url",
      "invalid-sdp",
      "ice",
      "initialization",
    ])
    .optional(),
  transportHttpStatus: z.number().int().min(0).max(599).optional(),
  encoderErrors: z
    .array(
      z.object({
        backend: z.enum(["nvenc", "amf", "x264"]),
        stage: z.enum([
          "driver",
          "adapter",
          "session",
          "initialize",
          "format",
          "encoder",
        ]),
        code: z
          .string()
          .max(100)
          .regex(
            /^(?:not-reported|NV_ENC_ERR_[A-Z_]+|AMF_[A-Z_]+|0[xX][a-fA-F0-9]{8})$/,
          ),
        at: z.number().finite(),
      }),
    )
    .max(32)
    .optional(),
  requestedEncoder: nativeEncoderIdSchema.optional(),
  selectedEncoder: nativeEncoderIdSchema.or(z.literal("")).optional(),
  encoderBackend: z.enum(["nvenc", "amf", "x264", ""]).optional(),
  hardwareEncoder: z.boolean().optional(),
  deviceAudioFallback: z.boolean().optional(),
  encoderFailure: z
    .string()
    .max(80)
    .regex(/^[a-z-]*$/)
    .optional(),
  encoderAttempts: z
    .array(
      z.object({
        id: nativeEncoderIdSchema,
        backend: z.enum(["nvenc", "amf", "x264"]),
        result: z
          .string()
          .max(80)
          .regex(/^[a-z-]+$/),
      }),
    )
    .max(32)
    .optional(),
  ...fields(nativeNumbers, number.optional()),
  outputPhase: z.enum(["stopped", "starting", "active", "failed"]).optional(),
  outputActive: z.boolean().optional(),
  sourcesActive: z.boolean().optional(),
  videoSourceActive: z.boolean().optional(),
  audioSourceActive: z.boolean().optional(),
});
export const diagnosticRecordSchema = z.object({
  gpu: gpuDiagnosticSchema.optional(),
  issues: diagnosticIssues,
  v: z.literal(1),
  appVersion: text.optional(),
  at: number,
  monotonicMs: number,
  session: z.string().uuid(),
  sequence: number.int().nonnegative(),
  kind: z.enum(["sample", "event", "resources", "server", "marker", "gap"]),
  room: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  context: z
    .object({
      connection: text,
      share: text,
      quality: z.enum(["saver", "cinema", "game"]),
      noiseReduction: z.enum(["off", "basic", "enhanced"]).optional(),
      pushToTalk: z.boolean().optional(),
      watching: z.boolean(),
      hidden: z.boolean(),
      online: z.boolean(),
    })
    .optional(),
  media: mediaDiagnosticSchema.optional(),
  native: nativeDiagnosticSchema.optional(),
  event: z
    .object({
      name: text,
      count: number.optional(),
      durationMs: number.optional(),
      reason: number.optional(),
    })
    .optional(),
  renderer: z
    .object({
      schedulerLagMs: number,
      longTaskCount: number,
      longTaskMs: number,
      heapUsed: number.optional(),
      heapLimit: number.optional(),
    })
    .optional(),
  resources: z
    .object({
      freeMemory: number,
      totalMemory: number,
      cpuPercent: number.optional(),
      load1: number,
      processes: z
        .array(
          z.object({
            type: text,
            pid: number,
            cpuPercent: number,
            workingSetKb: number,
            peakWorkingSetKb: number.optional(),
          }),
        )
        .max(30),
    })
    .optional(),
  server: diagnosticServerSchema.optional(),
  request: z
    .object({
      durationMs: number,
      clockOffsetMs: number.optional(),
      clockUncertaintyMs: number.optional(),
      status: z.enum(["ok", "failed", "timeout", "notSignedIn"]),
    })
    .optional(),
});
export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;
export type MediaDiagnostic = z.infer<typeof mediaDiagnosticSchema>;
export interface DiagnosticHistoryStatus {
  since?: number;
  until?: number;
  records: number;
  bytes: number;
  writeFailures: number;
  corruptRecords?: number;
  dropped: number;
  retentionMs: number;
}
export function safeDiagnosticRecord(value: unknown): DiagnosticRecord {
  const entry = diagnosticRecordSchema.parse(value);
  if (JSON.stringify(entry).length > diagnosticRecordLimit)
    throw new Error("诊断记录过大");
  return entry;
}
// Repair only optional telemetry, never the envelope or permission/identity fields.
// Called before IPC by our collector; untrusted writes remain strictly validated.
export function repairDiagnosticRecord(input: unknown): DiagnosticRecord {
  const candidate = structuredClone(input) as Record<string, unknown>;
  const issues: DiagnosticIssue[] = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    const parsed = diagnosticRecordSchema.safeParse(candidate);
    if (parsed.success) {
      const entry = parsed.data;
      if (issues.length)
        entry.issues = [...(entry.issues ?? []), ...issues].slice(0, 64);
      while (
        JSON.stringify(entry).length > diagnosticRecordLimit &&
        entry.media?.tracks.length
      ) {
        entry.media.tracks.pop();
        if (!entry.issues?.some((x) => x.code === "truncated"))
          entry.issues = [
            ...(entry.issues ?? []).slice(0, 63),
            { stage: "record", code: "truncated", field: "media.tracks" },
          ];
      }
      return safeDiagnosticRecord(entry);
    }
    const error = parsed.error.issues[0]!;
    const path = error.path as (string | number)[];
    const root = path[0];
    if (!["media", "native", "renderer", "resources"].includes(String(root)))
      throw parsed.error;
    let parent: Record<string, unknown> | unknown[] = candidate;
    for (const key of path.slice(0, -1))
      parent = (parent as Record<string, unknown>)[key] as Record<
        string,
        unknown
      >;
    const key = path.at(-1)!;
    const value = (parent as Record<string, unknown>)[key];
    issues.push({
      stage:
        root === "media"
          ? path[1] === "playback"
            ? "playback"
            : "media"
          : (root as "native" | "renderer" | "resources"),
      code:
        typeof value === "number" && !Number.isFinite(value)
          ? "invalid-number"
          : "invalid-field",
      field: path.join("."),
    });
    if (value === undefined) {
      // A required member field cannot be omitted: drop only that member,
      // preserving the healthy sibling tracks/processes and other telemetry.
      const member = path.findIndex((key) => typeof key === "number");
      if (member > 0) {
        let array: unknown = candidate;
        for (const key of path.slice(0, member))
          array = (array as Record<string, unknown>)[key];
        (array as unknown[]).splice(Number(path[member]), 1);
      } else delete candidate[String(root)];
    } else if (attempt === 62) delete candidate[String(root)];
    else if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  }
  return safeDiagnosticRecord(candidate);
}
export const diagnosticSnapshotSchema = z.object({
  encoderCapabilities: encoderCapabilitiesSchema.optional(),
  issues: diagnosticIssues,
  microphoneNoise: microphoneNoiseSchema.optional(),
  capturedAt: z.string().max(64).optional(),
  state: text.optional(),
  watching: z.boolean().optional(),
  tracks: z
    .array(
      rtcStatSchema.extend({
        source: text.optional(),
        local: z.boolean().optional(),
      }),
    )
    .max(200)
    .optional(),
  shareState: text.optional(),
  mediaCheck: z.enum(["available", "unavailable"]).optional(),
  serverCheck: z.enum(["available", "unavailable", "notSignedIn"]).optional(),
  connection: z
    .object({
      status: z.enum(["checking", "available", "unavailable"]),
      checkedAt: z.string().max(64).optional(),
    })
    .optional(),
  server: diagnosticServerSchema.optional(),
  browser: z.object({ userAgent: z.string().max(512) }).optional(),
});
