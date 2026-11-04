import { expect, test } from "bun:test";
import { projectGameDiagnostic } from "../src/shared/game-diagnostics";
import { safeDiagnosticRecord } from "@cinegather/contracts";
test("game diagnostics preserve useful phases and traffic counts while excluding endpoints, secrets and payloads", () => {
  const data = projectGameDiagnostic({
    type: "closed",
    grantId: "private-member",
    revision: 2,
    route: "relay",
    bytesSent: 123,
    bytesReceived: 456,
    clientSecret: "private-secret",
    payload: "game-data",
    server: "https://private.example",
  });
  const record = safeDiagnosticRecord({
    v: 1,
    at: Date.now(),
    monotonicMs: 1,
    session: crypto.randomUUID(),
    sequence: 1,
    kind: "event",
    game: data,
  });
  expect(record.game?.bytesSent).toBe(123);
  expect(record.game?.route).toBe("relay");
  expect(JSON.stringify(record)).not.toMatch(/private|game-data/);
  expect(
    projectGameDiagnostic({
      event: "transport",
      state: "failed",
      phase: "tls_dial",
      code: "TLS_CERTIFICATE",
      durationMs: 42,
    }),
  ).toMatchObject({
    event: "tls-failed",
    code: "TLS_CERTIFICATE",
    durationMs: 42,
  });
  expect(
    projectGameDiagnostic({
      type: "closed",
      bytesSent: Infinity,
      payload: "secret",
    }).bytesSent,
  ).toBeUndefined();
});
