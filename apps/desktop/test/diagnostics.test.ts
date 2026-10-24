import { test, expect } from "bun:test";
import { safeDiagnosticRecord } from "@cinegather/contracts";
import {
  diagnosticArchive,
  framePipeline,
  summarizeDiagnostics,
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
