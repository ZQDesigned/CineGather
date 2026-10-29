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
