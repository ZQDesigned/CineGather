import { test, expect } from "bun:test";
import {
  diagnosticSnapshotSchema,
  diagnosticRecordSchema,
} from "../src/diagnostics";
test("KTV configuration and actual processor fallback survive diagnostic snapshots and history", () => {
  const microphoneEffect = {
    requested: "ktv",
    active: "none",
    fallback: true,
    strength: 85,
  } as const;
  expect(
    diagnosticSnapshotSchema.parse({ microphoneEffect }).microphoneEffect,
  ).toEqual(microphoneEffect);
  const record = diagnosticRecordSchema.parse({
    v: 1,
    at: Date.now(),
    monotonicMs: 1,
    session: crypto.randomUUID(),
    sequence: 0,
    kind: "sample",
    media: {
      state: "connected",
      watching: false,
      tracks: [],
      microphoneEffect,
    },
  });
  expect(record.media?.microphoneEffect).toEqual(microphoneEffect);
});

test("picture classification and local monitor state survive export without audio or device identities", () => {
  const microphoneMonitor = {
    state: "active",
    volume: 30,
    outputLatencyMs: 20,
  } as const;
  const videoHealth = {
    kind: "decode",
    receivedFps: 30,
    decodedFps: 3,
    presentedFps: 3,
  } as const;
  expect(
    diagnosticSnapshotSchema.parse({ microphoneMonitor, videoHealth }),
  ).toMatchObject({ microphoneMonitor, videoHealth });
  const record = diagnosticRecordSchema.parse({
    v: 1,
    at: Date.now(),
    monotonicMs: 1,
    session: crypto.randomUUID(),
    sequence: 1,
    kind: "sample",
    microphoneMonitor,
    media: { state: "connected", watching: true, tracks: [], videoHealth },
  });
  expect(record.microphoneMonitor).toEqual(microphoneMonitor);
  expect(record.media?.videoHealth).toEqual(videoHealth);
});
