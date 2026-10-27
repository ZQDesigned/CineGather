import { expect, test } from "bun:test";
import { boundedStats, projectRTCStats } from "../src/diagnostics";
test("track stats projection retains transport and decoding evidence without candidate addresses", () => {
  const report = new Map<string, unknown>([
    [
      "C1",
      {
        id: "C1",
        type: "local-candidate",
        address: "1.2.3.4",
        candidateType: "relay",
        protocol: "udp",
        relayProtocol: "tls",
      },
    ],
    [
      "P1",
      {
        id: "P1",
        type: "candidate-pair",
        localCandidateId: "C1",
        currentRoundTripTime: 0.15,
      },
    ],
    [
      "R1",
      {
        id: "R1",
        type: "inbound-rtp",
        freezeCount: 2,
        totalDecodeTime: 3,
        jitterBufferDelay: 5,
        totalFreezesDuration: 1.2,
        token: "secret",
      },
    ],
  ]) as unknown as RTCStatsReport;
  const rows = projectRTCStats(report);
  expect(rows.find((row) => row.type === "candidate-pair")).toMatchObject({
    localCandidateType: "relay",
    transportProtocol: "udp",
    relayProtocol: "tls",
  });
  expect(rows.find((row) => row.type === "inbound-rtp")).toMatchObject({
    freezeCount: 2,
    totalDecodeTime: 3,
  });
  expect(JSON.stringify(rows)).not.toMatch(/1\.2\.3\.4|secret/);
});
test("a stalled stats promise cannot block the next sampling interval", async () => {
  expect(await boundedStats(() => new Promise(() => {}), 10)).toEqual({
    status: "timeout",
    stats: [],
  });
  expect(
    await boundedStats(async () => {
      throw new Error("private-url");
    }, 10),
  ).toEqual({ status: "failed", stats: [] });
});

test("one invalid RTC field does not erase the track's valid frame and encoder evidence", () => {
  const report = new Map([
    [
      "V",
      {
        id: "V",
        type: "outbound-rtp",
        kind: "video",
        framesEncoded: 120,
        totalEncodeTime: NaN,
        encoderImplementation: "OpenH264",
        address: "10.0.0.1",
      },
    ],
  ]) as unknown as RTCStatsReport;
  const rows = projectRTCStats(report);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    framesEncoded: 120,
    encoderImplementation: "OpenH264",
  });
  expect(rows[0]?.totalEncodeTime).toBeUndefined();
  expect(JSON.stringify(rows)).not.toContain("10.0.0.1");
});

test("a failed playback quality API preserves other display metrics and reports a sanitized cause", async () => {
  const { PlaybackProbe } = await import("../src/diagnostics");
  const probe = new PlaybackProbe();
  const video = {
    addEventListener() {},
    removeEventListener() {},
    ownerDocument: { hidden: false },
    clientWidth: 900,
    clientHeight: 500,
    readyState: 4,
    paused: false,
    ended: false,
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 15,
    playbackRate: 1,
    getVideoPlaybackQuality() {
      throw new Error("https://private/?token=secret");
    },
  };
  probe.bind(video as unknown as HTMLVideoElement);
  expect(probe.sample()).toMatchObject({
    width: 1920,
    currentTime: 15,
    hidden: false,
  });
  const issues = probe.takeIssues();
  expect(issues).toContainEqual({
    stage: "playback",
    code: "read-failed",
    field: "media.playback.totalFrames",
  });
  expect(JSON.stringify(issues)).not.toContain("private");
});
