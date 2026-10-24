import { test, expect } from "bun:test";
import {
  parseSfuMetrics,
  parseNetworkCounters,
  ServerDiagnostics,
} from "../src/server-diagnostics";
test("SFU metrics combine only known counters and enum labels without leaking names or IPs", () => {
  const rows = parseSfuMetrics(
    'livekit_packet_bytes{direction="outgoing",country="secret",node_id="private-node"} 12\nlivekit_packet_bytes{direction="outgoing",country="elsewhere"} 8\nuser_token{value="secret"} 1\nlivekit_packet_total{direction="incoming"} NaN\nlivekit_forward_latency 300',
  );
  expect(rows).toEqual([
    {
      name: "livekit_packet_bytes",
      direction: "outgoing",
      transmission: undefined,
      type: undefined,
      value: 20,
    },
    {
      name: "livekit_forward_latency",
      direction: undefined,
      transmission: undefined,
      type: undefined,
      value: 300,
    },
  ]);
  expect(JSON.stringify(rows)).not.toMatch(/secret|private-node|elsewhere/);
});
test("kernel UDP buffer errors and TCP retransmission counters are projected by name", () => {
  expect(
    parseNetworkCounters(
      "Udp: InErrors RcvbufErrors SndbufErrors\nUdp: 3 2 1\nTcp: RetransSegs\nTcp: 4\n",
    ),
  ).toEqual({
    udpInErrors: 3,
    udpReceiveBufferErrors: 2,
    udpSendBufferErrors: 1,
    tcpRetransmittedSegments: 4,
  });
});
test("server clock is fresh even while resource samples are cached and optional SFU metrics stay explicit", async () => {
  const service = new ServerDiagnostics("");
  const first = await service.snapshot();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await service.snapshot();
  expect(second.capturedAt).toBeGreaterThan(first.capturedAt);
  expect(second.sampledAt).toBe(first.sampledAt);
  expect(second.sfuStatus).toBe("unconfigured");
  expect(second.totalMemory).toBeGreaterThan(0);
});

test("configured SFU scrape is coalesced, cached, and excludes raw labels", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      requests++;
      return new Response(
        'livekit_packet_bytes{direction="outgoing",node_id="private-node"} 200\nlivekit_node_packet_total{type="dropped"} 2\n',
      );
    },
  });
  try {
    const service = new ServerDiagnostics(
      `http://127.0.0.1:${server.port}/metrics`,
    );
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.snapshot()),
    );
    expect(requests).toBe(1);
    expect(results[0]!.sfuStatus).toBe("available");
    expect(JSON.stringify(results)).not.toContain("private-node");
  } finally {
    server.stop(true);
  }
});
