import { test, expect } from "bun:test";
import {
  safeDiagnosticRecord,
  diagnosticSnapshotSchema,
} from "@cinegather/contracts";
import {
  diagnosticArchive,
  framePipeline,
  summarizeDiagnostics,
  nativePipeline,
} from "../src/shared/diagnostics";
import { DiagnosticHistory } from "../src/main/diagnostic-history";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync, strFromU8 } from "fflate";
const session = "11111111-1111-4111-8111-111111111111";
const entry = (at: number, sequence = 0) => ({
  v: 1 as const,
  at,
  monotonicMs: at,
  session,
  sequence,
  kind: "event" as const,
  event: { name: "connected" },
});
test("native pipeline includes failed negotiations and does not turn stale snapshots into measured frame rates", () => {
  const rows = [
    {
      ...entry(1000),
      native: {
        sampledAt: 1000,
        sourcesActive: true,
        outputActive: false,
        outputPhase: "starting" as const,
        transportPhase: "dtls" as const,
        outputTotalFrames: 0,
      },
    },
    {
      ...entry(6000),
      native: {
        sampledAt: 1000,
        sourcesActive: true,
        outputActive: false,
        outputPhase: "starting" as const,
        transportPhase: "dtls" as const,
        outputTotalFrames: 0,
      },
    },
    {
      ...entry(7000),
      native: {
        sampledAt: 1000,
        hostExitCode: 3,
        outputPhase: "failed" as const,
        transportFailure: "dtls" as const,
        outputActive: false,
        sourcesActive: false,
      },
    },
  ];
  const pipeline = nativePipeline(rows);
  expect(pipeline).toHaveLength(3);
  expect(pipeline[2]).toMatchObject({
    outputPhase: "failed",
    transportFailure: "dtls",
    hostExitCode: 3,
  });
  expect(pipeline.every((row) => row.encodedFps === undefined)).toBe(true);
});
test("diagnostic projection strips secrets, endpoints, IPs and raw native logs", () => {
  const safe = safeDiagnosticRecord({
    ...entry(100),
    token: "secret",
    native: {
      activeFps: 30,
      outputError: "secret",
      frameworks: "private-path",
    },
    media: {
      state: "connected",
      watching: true,
      tracks: [
        {
          track: "TR_1",
          participant: "a".repeat(64),
          source: "screen_share",
          local: false,
          kind: "video",
          muted: false,
          subscribed: true,
          status: "ok",
          stats: [
            {
              type: "inbound-rtp",
              bytesReceived: 42,
              address: "1.2.3.4",
              token: "secret",
              url: "https://private",
            },
          ],
        },
      ],
    },
  });
  expect(safe.native).toEqual({ activeFps: 30 });
  expect(JSON.stringify(safe)).not.toMatch(/secret|1\.2\.3\.4|private/);
  expect(safe.media!.tracks[0]!.stats[0]!.bytesReceived).toBe(42);
});
test("two-hour persisted history retains a full preceding hour across restart and a torn final write", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-diagnostics-"));
  try {
    let now = 1_800_000_000_000;
    const history = new DiagnosticHistory(root, () => now);
    for (let i = 0; i < 7500; i++) {
      now += 2000;
      await history.append(entry(now, i));
    }
    const status = await history.status();
    expect(status.until! - status.since!).toBeGreaterThanOrEqual(
      60 * 60 * 1000,
    );
    expect(status.until! - status.since!).toBeLessThanOrEqual(
      2 * 60 * 60 * 1000 + 60_000,
    );
    const files = await history.files();
    await appendFile(join(root, files.at(-1)!), '{"torn":');
    const restarted = new DiagnosticHistory(root, () => now);
    const records = await restarted.read();
    expect(records.length).toBeGreaterThan(1800);
    expect(records.at(-1)!.sequence).toBe(7499);
    expect((await restarted.status()).since).toBe(status.since);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("analysis uses RTC timestamps, isolates tracks and suppresses counter resets and sample gaps", () => {
  const sample = (
    at: number,
    timestamp: number,
    bytes: number,
    frames: number,
  ) =>
    safeDiagnosticRecord({
      ...entry(at),
      kind: "sample",
      media: {
        state: "connected",
        watching: true,
        tracks: [
          {
            track: "TR_1",
            participant: "a".repeat(64),
            source: "screen_share",
            local: false,
            kind: "video",
            muted: false,
            subscribed: true,
            status: "ok",
            stats: [
              {
                type: "inbound-rtp",
                id: "R1",
                timestamp,
                bytesReceived: bytes,
                framesDecoded: frames,
                packetsLost: 0,
              },
            ],
          },
        ],
      },
    });
  const result = summarizeDiagnostics([
    sample(10000, 100, 100, 3),
    sample(12000, 2100, 1100, 23),
    sample(14000, 4100, 5, 1),
    sample(30000, 20100, 7000, 30),
  ]);
  expect(result.intervals[0]).toMatchObject({ bitrateBps: 4000, fps: 10 });
  expect(result.intervals[1]!.reset).toBe(true);
  expect(result.intervals[1]!.bitrateBps).toBeUndefined();
  expect(result.intervals[2]!.gap).toBe(true);
});

test("export is a deflated ZIP with raw timeline, coverage, replay intervals and privacy guide", async () => {
  const records = Array.from({ length: 2000 }, (_, i) =>
    entry(1_800_000_000_000 + i * 2000, i),
  );
  const archive = await diagnosticArchive(
    records,
    { appVersion: "0.1.5" },
    { state: "connected" },
  );
  const files = unzipSync(archive);
  expect(files["frame-pipeline.csv"]).toBeTruthy();
  expect(Object.keys(files).sort()).toEqual([
    "README.txt",
    "current.json",
    "frame-pipeline.csv",
    "intervals.csv",
    "manifest.json",
    "native-pipeline.csv",
    "summary.json",
    "timeline.ndjson",
  ]);
  expect(
    JSON.parse(strFromU8(files["manifest.json"]!)).coverage.wallSpanMs,
  ).toBeGreaterThan(60 * 60 * 1000);
  expect(strFromU8(files["timeline.ndjson"]!).trim().split("\n")).toHaveLength(
    2000,
  );
  expect(archive.length).toBeLessThan(JSON.stringify(records).length / 2);
});
test("journal write errors do not break media, and report loss instead of claiming a full history", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-diagnostics-fail-"));
  try {
    const history = new DiagnosticHistory(join(root, "not-a-directory"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "not-a-directory"), "x");
    await expect(history.append(entry(Date.now()))).resolves.toBe(false);
    expect((await history.status()).writeFailures).toBeGreaterThan(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storage capacity eviction is bounded and explicitly declared", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-diagnostic-cap-"));
  try {
    let now = 1_800_000_000_000;
    const history = new DiagnosticHistory(root, () => now, 1024);
    for (let i = 0; i < 50; i++) {
      now += 60000;
      await history.append(entry(now, i));
    }
    const status = await history.status();
    expect(status.bytes).toBeLessThanOrEqual(1024);
    expect(status.dropped).toBeGreaterThan(0);
    expect(status.records).toBeLessThan(50);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frame pipeline distinguishes a 30 fps reception from a 3 fps decode/presentation without treating viewer presets as sender targets", () => {
  const make = (
    at: number,
    framesReceived: number,
    framesDecoded: number,
    presentedFrames: number,
  ) =>
    safeDiagnosticRecord({
      ...entry(at),
      kind: "sample",
      context: {
        connection: "connected",
        share: "idle",
        quality: "cinema",
        watching: true,
        hidden: false,
        online: true,
      },
      media: {
        state: "connected",
        watching: true,
        tracks: [
          {
            track: "TR_video",
            participant: "a".repeat(64),
            source: "screen_share",
            local: false,
            kind: "video",
            muted: false,
            subscribed: true,
            status: "ok",
            stats: [
              {
                id: "R1",
                type: "inbound-rtp",
                timestamp: at,
                framesReceived,
                framesDecoded,
                frameWidth: 1920,
                frameHeight: 1080,
              },
            ],
          },
        ],
        playback: {
          readyState: 4,
          paused: false,
          ended: false,
          hidden: false,
          width: 1920,
          height: 1080,
          currentTime: at / 1000,
          playbackRate: 1,
          presentedFrames,
        },
      },
    });
  const entries = [make(10000, 30, 3, 3), make(12000, 90, 9, 9)];
  const rows = framePipeline(entries, summarizeDiagnostics(entries).intervals);
  expect(rows[1]).toMatchObject({
    role: "viewer",
    receivedFps: 30,
    decodedFps: 3,
    presentedFps: 3,
    width: 1920,
    height: 1080,
  });
  expect(rows[1]!.targetFps).toBeUndefined();
});

test("diagnostic snapshots preserve requested and active noise modes without raw failure messages", () => {
  const result = diagnosticSnapshotSchema.parse({
    microphoneNoise: {
      requested: "enhanced",
      active: "basic",
      fallback: true,
      reason: "https://private-token",
    },
  });
  expect(result).toHaveProperty("microphoneNoise", {
    requested: "enhanced",
    active: "basic",
    fallback: true,
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
});

test("partial diagnostics retain playback and RTP evidence when one numeric field is invalid", async () => {
  const { repairDiagnosticRecord } = await import("@cinegather/contracts");
  const sample = repairDiagnosticRecord({
    ...entry(100),
    kind: "sample",
    media: {
      state: "connected",
      watching: true,
      tracks: [],
      playback: {
        readyState: 4,
        paused: false,
        ended: false,
        hidden: false,
        width: 1920,
        height: 1080,
        currentTime: Infinity,
        playbackRate: 1,
        presentedFrames: 300,
        processingDuration: NaN,
      },
    },
    renderer: { schedulerLagMs: 0, longTaskCount: 0, longTaskMs: 0 },
    privateToken: "Bearer do-not-export",
  });
  expect(sample.media?.playback).toMatchObject({
    width: 1920,
    presentedFrames: 300,
  });
  expect(sample.media?.playback?.currentTime).toBeUndefined();
  expect(sample.issues).toContainEqual({
    stage: "playback",
    code: "invalid-number",
    field: "media.playback.currentTime",
  });
  expect(sample.issues).toContainEqual({
    stage: "playback",
    code: "invalid-number",
    field: "media.playback.processingDuration",
  });
  expect(JSON.stringify(sample)).not.toContain("do-not-export");
  expect(safeDiagnosticRecord(sample)).toEqual(sample);
});

test("disk failure fallback retains over one hour, explains the failure and expires old records", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-diagnostic-memory-"));
  const { writeFile } = await import("node:fs/promises");
  try {
    const blocked = join(root, "blocked");
    await writeFile(blocked, "x");
    let now = 1_800_000_000_000;
    const history = new DiagnosticHistory(blocked, () => now);
    for (let i = 0; i < 1900; i++) {
      now += 2000;
      await history.append(entry(now, i));
    }
    const records = await history.read();
    expect(records).toHaveLength(1900);
    expect(records.at(-1)!.at - records[0]!.at).toBeGreaterThan(60 * 60 * 1000);
    expect(records[0]!.issues).toContainEqual({
      stage: "storage",
      code: "storage-failed",
    });
    const summary = summarizeDiagnostics(records).summary;
    expect(summary.collectionIssues).toContainEqual({
      stage: "storage",
      code: "storage-failed",
      count: 1900,
      firstAt: records[0]!.at,
      lastAt: records.at(-1)!.at,
    });
    now += 3 * 60 * 60 * 1000;
    expect(await history.read()).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("encoder evidence distinguishes actual hardware, software and unknown implementations", async () => {
  const { encoderMode } = await import("../src/shared/diagnostics");
  expect(
    encoderMode({
      powerEfficientEncoder: true,
      encoderImplementation: "ExternalEncoder",
    }),
  ).toBe("hardware");
  expect(
    encoderMode({
      powerEfficientEncoder: false,
      encoderImplementation: "OpenH264",
    }),
  ).toBe("software");
  expect(encoderMode({ encoderImplementation: "OpenH264" })).toBe("software");
  expect(encoderMode({ encoderImplementation: "ExternalEncoder" })).toBe(
    "unknown",
  );
  expect(encoderMode()).toBe("unknown");
});

test("invalid required metadata removes only the affected track and keeps IPC validation strict", async () => {
  const { repairDiagnosticRecord } = await import("@cinegather/contracts");
  const track = {
    track: "TR_healthy",
    participant: "a".repeat(64),
    source: "screen_share",
    local: true,
    kind: "video",
    muted: false,
    subscribed: true,
    status: "ok",
    stats: [{ framesEncoded: 150 }],
  };
  const input = {
    ...entry(100),
    media: {
      state: "connected",
      watching: true,
      tracks: [{ ...track, track: "TR_bad", muted: Infinity }, track],
    },
  };
  expect(() => safeDiagnosticRecord(input)).toThrow();
  const result = repairDiagnosticRecord(input);
  expect(result.media?.tracks).toHaveLength(1);
  expect(result.media?.tracks[0]?.track).toBe("TR_healthy");
  expect(result.media?.tracks[0]?.stats[0]?.framesEncoded).toBe(150);
  expect(result.issues).toContainEqual({
    stage: "media",
    code: "invalid-number",
    field: "media.tracks.0.muted",
  });
  expect(() =>
    repairDiagnosticRecord({ ...input, session: "not-a-session" }),
  ).toThrow();
});

test("native pipeline uses observed output counters, separates restarts and never labels render FPS as capture FPS", async () => {
  const { nativePipeline } = await import("../src/shared/diagnostics");
  const samples = [1000, 6000, 11000, 16000].map((at, i) =>
    safeDiagnosticRecord({
      ...entry(at, i),
      native: {
        sourcesActive: true,
        outputActive: true,
        selectedEncoder: "x264",
        encoderBackend: "x264",
        hardwareEncoder: false,
        outputTotalFrames: [0, 150, 2, 152][i],
        outputBytes: [0, 300000, 1000, 301000][i],
        captureArrivedFrames: i * 150,
        captureCopiedFrames: i * 15,
        renderTotalFrames: i * 150,
        activeFps: 30,
      },
    }),
  );
  const rows = nativePipeline(samples);
  expect(rows[1]?.encodedFps).toBe(30);
  expect(rows[1]?.captureArrivalFps).toBe(30);
  expect(rows[1]?.capturedFps).toBe(3);
  expect(rows[1]?.bitrateBps).toBe(480000);
  expect(rows[1]?.encoderMode).toBe("software");
  expect(rows[2]?.encodedFps).toBeUndefined();
  expect(rows[2]?.reset).toBe(true);
  expect(rows[3]?.encodedFps).toBe(30);
  expect(rows[1]).not.toHaveProperty("captureFps");
});
