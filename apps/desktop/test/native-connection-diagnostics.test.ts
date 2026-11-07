import { expect, test } from "bun:test";
import {
  decodeNativeNetwork,
  NativeCaptureEvents,
} from "../src/main/capture/native-capture-events";
import { safeDiagnosticRecord } from "@cinegather/contracts";
const wire = {
  sequence: 1,
  method: 1,
  curlCode: 28,
  httpStatus: 0,
  osError: 10060,
  tlsBackendCode: 1,
  tlsVerifyResult: -1,
  tlsNativeCode: 0x80092013,
  addressFamily: 4,
  redirectCount: 0,
  connectCount: 1,
  dnsUs: 500,
  tcpUs: 5000,
  tlsUs: -1,
  requestReadyUs: -1,
  firstByteUs: -1,
  totalUs: 8000000,
  wallUs: 8000200,
};
test("native curl telemetry retains exact codes and reported stage timings without inventing TLS success", () => {
  const n = decodeNativeNetwork(wire)!;
  expect(n).toMatchObject({
    method: "POST",
    curlCode: 28,
    errorKind: "timeout",
    osError: 10060,
    tlsBackend: "schannel",
    tlsNativeCode: 0x80092013,
    timings: { dnsMs: 0.5, tcpMs: 5, totalMs: 8000, wallMs: 8000.2 },
  });
  expect(n.timings.tlsMs).toBeUndefined();
  expect(n.tlsVerifyResult).toBeUndefined();
  expect(
    decodeNativeNetwork({ ...wire, url: "https://secret/?token=private" }),
  ).toBeUndefined();
  expect(decodeNativeNetwork({ ...wire, totalUs: NaN })).toBeUndefined();
  const record = safeDiagnosticRecord({
    v: 1,
    at: 1,
    monotonicMs: 1,
    session: crypto.randomUUID(),
    sequence: 1,
    kind: "event",
    native: { network: n },
  });
  expect(record.native?.network).toEqual(n);
  expect(JSON.stringify(record)).not.toMatch(/secret|private|https:/);
});
test("host crash/rebuild/probe and intentional shutdown are correlated while late exits cannot change the replacement", () => {
  const entries: ReturnType<NativeCaptureEvents["snapshot"]>[] = [];
  const names: string[] = [];
  let now = 100;
  const journal = new NativeCaptureEvents(
    (e) => {
      names.push(e.name);
      entries.push(e.native);
    },
    () => now,
  );
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  journal.spawn(a, 100, "sources");
  now += 20;
  journal.ready(a);
  const attempt = journal.beginShare();
  now += 10;
  journal.phase(a, "setup");
  now += 50;
  journal.phase(a, "http");
  now += 8000;
  journal.network(a, wire);
  journal.exit(a, "response-timeout", null, "SIGKILL");
  journal.endShare("failed");
  now += 10;
  journal.spawn(b, 101, "diagnostic-probe");
  journal.ready(b);
  journal.exit(a, "unexpected-exit", 9);
  expect(journal.snapshot().hostSession).toBe(b);
  expect(names).toContain("native-host-rebuild");
  expect(entries.find((e) => e.hostSession === b)?.previousHostSession).toBe(a);
  const network = entries.find((e) => e.network)!;
  expect(network.shareAttempt).toBe(attempt);
  expect(network.connectionElapsedMs).toBeGreaterThanOrEqual(8000);
  journal.exit(b, "shutdown", 0);
  expect(entries.at(-1)?.hostExitReason).toBe("shutdown");
  expect(entries.find((e) => e.hostSession === b)?.hostRestartCount).toBe(1);
});
test("malformed numeric telemetry never throws and retired hosts cannot inherit another share attempt", () => {
  expect(() =>
    decodeNativeNetwork({ ...wire, tlsNativeCode: 86400000000 }),
  ).not.toThrow();
  expect(
    decodeNativeNetwork({ ...wire, tlsNativeCode: 86400000000 }),
  ).toBeUndefined();
  const entries: {
    name: string;
    native: ReturnType<NativeCaptureEvents["snapshot"]>;
  }[] = [];
  const j = new NativeCaptureEvents((e) => entries.push(e));
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  j.spawn(a, 1, "share");
  const first = j.beginShare();
  j.endShare("failed");
  j.exit(a, "unexpected-exit", 3);
  const second = j.beginShare();
  expect(j.snapshot().hostSession).toBeUndefined();
  j.spawn(b, 2, "share");
  j.phase(b, "http");
  j.exit(a, "unexpected-exit", 3);
  expect(entries.at(-1)?.native.shareAttempt).toBe(first);
  j.network(a, { ...wire, sequence: 2 });
  expect(entries.at(-1)?.native.shareAttempt).toBe(first);
  expect(j.snapshot()).toMatchObject({ hostSession: b, shareAttempt: second });
});
test("phase observations cannot regress on late status messages and terminal timings use the final clock", () => {
  let now = 0;
  const entries: {
    name: string;
    native: ReturnType<NativeCaptureEvents["snapshot"]>;
  }[] = [];
  const j = new NativeCaptureEvents(
      (e) => entries.push(e),
      () => now,
    ),
    host = crypto.randomUUID();
  j.spawn(host, 1, "share");
  j.beginShare();
  now = 10;
  j.phase(host, "setup");
  now = 100;
  j.phase(host, "http");
  j.phase(host, "setup");
  expect(j.snapshot().transportPhase).toBe("http");
  now = 8100;
  j.endShare("failed", { connectionElapsedMs: 100, stageTimings: {} });
  expect(entries.at(-1)?.native.connectionElapsedMs).toBe(8100);
  expect(entries.at(-1)?.native.stageTimings?.setupMs).toBe(90);
});

test("native stage evidence survives timeout/rebuild/export and rejects raw data or invalid phases", async () => {
  const events: import("../src/main/capture/native-capture-events").NativeCaptureEvent[] =
    [];
  const journal = new NativeCaptureEvents((e) => events.push(e));
  const host = crypto.randomUUID();
  journal.spawn(host, 12, "sources");
  journal.beginShare();
  const progress = {
    sequence: 1,
    span: 3,
    commandSequence: 4,
    command: "start",
    sourceKind: "window",
    stage: "window-init-graphics",
    state: "waiting",
    elapsedMs: 1200,
  };
  // Avoid accepting arbitrary stages, strings, window titles or raw commands.
  const observe = (raw: unknown) => journal.progress(host, raw);
  expect(typeof journal.progress).toBe("function");
  observe(progress);
  expect(journal.snapshot()).toMatchObject({
    progress,
    pendingProgress: [progress],
  });
  observe({
    ...progress,
    sequence: 2,
    state: "acquired",
    waitMs: 1300,
    elapsedMs: 1300,
  });
  observe({
    ...progress,
    sequence: 3,
    state: "held",
    waitMs: 1300,
    elapsedMs: 2500,
  });
  journal.record("native-host-timeout", {
    ...journal.snapshot(),
    hostExitReason: "response-timeout",
  });
  const snapshot = journal.snapshot();
  const record = safeDiagnosticRecord({
    v: 1,
    at: 1,
    monotonicMs: 1,
    session: crypto.randomUUID(),
    sequence: 1,
    kind: "event",
    event: { name: "native-host-timeout" },
    native: snapshot,
  });
  expect(record.native?.pendingProgress?.[0]).toMatchObject({
    state: "held",
    waitMs: 1300,
    elapsedMs: 2500,
  });
  const before = events.length;
  observe({ ...progress, sequence: 4, title: "private title" });
  observe({ ...progress, sequence: 4, stage: "https://secret" });
  observe({ ...progress, sequence: 4, elapsedMs: NaN });
  expect(events).toHaveLength(before);
  observe({
    ...progress,
    sequence: 4,
    state: "complete",
    waitMs: 1300,
    elapsedMs: 2600,
  });
  expect(journal.snapshot().pendingProgress).toEqual([]);
  observe(progress); // delayed old begin/wait must never resurrect a finished span
  expect(journal.snapshot().pendingProgress).toEqual([]);
  journal.exit(host, "response-timeout", null, "SIGKILL");
  journal.endShare("failed");
  journal.spawn(crypto.randomUUID(), 13, "sources");
  expect(journal.snapshot().progress).toBeUndefined();
  expect(JSON.stringify(events)).not.toMatch(/private title|https:/);
  const { diagnosticArchive } = await import("../src/shared/diagnostics");
  const { unzipSync, strFromU8 } = await import("fflate");
  const bytes = await diagnosticArchive(
    [
      record,
      { ...record, sequence: 2, event: { name: "native-startup-progress" } },
    ],
    {},
    {},
  );
  const files = unzipSync(bytes);
  expect(strFromU8(files["native-startup.csv"]!)).toContain(
    "window-init-graphics",
  );
  expect(strFromU8(files["timeline.ndjson"]!)).toContain('"waitMs":1300');
});
