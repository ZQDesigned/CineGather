import { expect, test } from "bun:test";
import {
  diagnosticSnapshotSchema,
  diagnosticRecordSchema,
} from "../src/diagnostics";
test("singing component measurements survive diagnostic snapshots and retained records without audio or device identities", () => {
  const karaoke = {
    enabled: true,
    singing: true,
    headphones: true,
    gain: 1,
    reverb: 0.1,
    monitor: 0,
    delayMs: 0,
    receiverTargetMs: 10,
    processorActive: true,
    capture: {
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: "private-device",
    },
    measurements: [
      {
        track: "audio-0",
        queueMs: 21,
        transportRttMs: 12,
        concealedPercent: 0.1,
      },
    ],
    rawAudio: "must not retain",
  };
  const snapshot = diagnosticSnapshotSchema.parse({ karaoke });
  expect(snapshot.karaoke).toMatchObject({
    delayMs: 0,
    receiverTargetMs: 10,
    measurements: [{ queueMs: 21, transportRttMs: 12 }],
  });
  expect(JSON.stringify(snapshot)).not.toContain("must not retain");
  expect(JSON.stringify(snapshot)).not.toContain("private-device");
  const record = diagnosticRecordSchema.parse({
    v: 1,
    at: Date.now(),
    monotonicMs: 100,
    session: crypto.randomUUID(),
    sequence: 0,
    kind: "sample",
    media: { state: "connected", watching: false, tracks: [], karaoke },
  });
  expect(record.media?.karaoke?.capture?.noiseSuppression).toBe(false);
});
