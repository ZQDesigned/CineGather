import {
  gameDiagnosticSchema,
  type GameDiagnostic,
} from "@cinegather/contracts";
/** Project only fixed, non-content telemetry. Never serialize a native configuration. */
export function projectGameDiagnostic(
  raw: unknown,
  context: Partial<GameDiagnostic> = {},
): GameDiagnostic {
  const event =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let name: string | undefined;
  if (
    event.event === "process" &&
    ["started", "exited"].includes(String(event.state))
  )
    name = `process-${event.state}`;
  else if (event.event === "transport")
    name =
      event.phase === "tls_dial"
        ? `tls-${event.state}`
        : event.state === "expired"
          ? "grant-expired"
          : "control-failed";
  else if (
    ["connected", "closed", "failed", "expired"].includes(String(event.type))
  )
    name = `gateway-${event.type}`;
  if (event.type === "datagram") name = "datagram";
  const candidate = {
    ...context,
    event: name,
    route: event.route,
    dropped: event.dropped,
    mappings: event.mappings,
    queuedBytes: event.queuedBytes,
    packetsSent: event.packetsSent,
    packetsReceived: event.packetsReceived,
    code: typeof event.code === "string" ? event.code : undefined,
    generation: event.generation,
    exitCode: event.event === "process" ? event.code : undefined,
    revision: event.revision ?? context.revision,
    bytesSent: event.bytesSent,
    bytesReceived: event.bytesReceived,
    durationMs: event.durationMs,
  };
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(gameDiagnosticSchema.shape)) {
    const parsed = schema.safeParse(candidate[key as keyof typeof candidate]);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  return gameDiagnosticSchema.parse(result);
}
