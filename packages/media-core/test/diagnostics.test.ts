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
