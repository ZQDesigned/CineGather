import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  nativeNetworkSchema,
  type NativeNetwork,
  type nativeDiagnosticSchema,
  type nativeHostTriggerSchema,
} from "@cinegather/contracts";
type Native = z.infer<typeof nativeDiagnosticSchema>;
export type NativeCaptureEvent = { name: string; native: Native };
type Trigger = z.infer<typeof nativeHostTriggerSchema>;
type Phase = NonNullable<Native["transportPhase"]>;
const keys = [
  "sequence",
  "method",
  "curlCode",
  "httpStatus",
  "osError",
  "tlsBackendCode",
  "tlsVerifyResult",
  "tlsNativeCode",
  "addressFamily",
  "redirectCount",
  "connectCount",
  "dnsUs",
  "tcpUs",
  "tlsUs",
  "requestReadyUs",
  "firstByteUs",
  "totalUs",
  "wallUs",
] as const;
const rawSchema = z.strictObject(
  Object.fromEntries(
    keys.map((k) => [k, z.number().int().min(-1).max(86400000000)]),
  ) as Record<(typeof keys)[number], z.ZodNumber>,
);
export function decodeNativeNetwork(raw: unknown): NativeNetwork | undefined {
  const publicValue = nativeNetworkSchema.safeParse(raw);
  if (publicValue.success) return publicValue.data;
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return;
  const r = parsed.data;
  if (
    r.sequence < 1 ||
    ![1, 2].includes(r.method) ||
    r.curlCode < 0 ||
    r.curlCode > 999 ||
    r.httpStatus > 599 ||
    r.tlsBackendCode < 0 ||
    r.tlsBackendCode > 6 ||
    ![-1, 0, 4, 6].includes(r.addressFamily)
  )
    return;
  const value = (n: number) => (n >= 0 ? n : undefined);
  const ms = (n: number) => (n >= 0 ? n / 1000 : undefined);
  const kind: NativeNetwork["errorKind"] =
    r.curlCode === 0
      ? "none"
      : r.curlCode === 5
        ? "proxy-dns"
        : r.curlCode === 6
          ? "dns"
          : r.curlCode === 7
            ? "connect"
            : r.curlCode === 28
              ? "timeout"
              : [35, 53, 54, 59, 64, 66, 80, 83, 90, 91].includes(r.curlCode)
                ? "tls"
                : [51, 58, 60, 77, 82].includes(r.curlCode)
                  ? "certificate"
                  : r.curlCode === 55
                    ? "send"
                    : r.curlCode === 56
                      ? "receive"
                      : r.curlCode === 47
                        ? "redirect"
                        : "other";
  const output = nativeNetworkSchema.safeParse({
    sequence: r.sequence,
    method: r.method === 1 ? "POST" : "DELETE",
    curlCode: r.curlCode,
    errorKind: kind,
    httpStatus: value(r.httpStatus),
    osError: value(r.osError),
    tlsNativeCode: value(r.tlsNativeCode),
    tlsVerifyResult:
      r.tlsBackendCode === 1 ? undefined : value(r.tlsVerifyResult),
    tlsBackend: (
      [
        "unknown",
        "schannel",
        "secure-transport",
        "openssl",
        "gnutls",
        "libressl",
        "boringssl",
      ] as const
    )[r.tlsBackendCode],
    addressFamily:
      r.addressFamily === 4
        ? "ipv4"
        : r.addressFamily === 6
          ? "ipv6"
          : undefined,
    redirectCount: value(r.redirectCount),
    connectCount: value(r.connectCount),
    timings: {
      dnsMs: ms(r.dnsUs),
      tcpMs: ms(r.tcpUs),
      tlsMs: ms(r.tlsUs),
      requestReadyMs: ms(r.requestReadyUs),
      firstByteMs: ms(r.firstByteUs),
      totalMs: ms(r.totalUs),
      wallMs: ms(r.wallUs),
    },
  });
  return output.success ? output.data : undefined;
}
export class NativeCaptureEvents {
  private generation = 0;
  private hosts = new Map<
    string,
    Native & { spawned: number; alive: boolean }
  >();
  private current?: string;
  private attempt?: {
    id: string;
    start: number;
    finished: boolean;
    hostSession?: string;
    phase: Phase;
    phaseStart: number;
    timings: NonNullable<Native["stageTimings"]>;
  };
  private networkSeen = new Set<string>();
  constructor(
    private readonly sink: (e: NativeCaptureEvent) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}
  snapshot(session = this.current): Native {
    const a = this.attempt;
    if (session === this.current && a && !a.finished && !a.hostSession)
      return {
        shareAttempt: a.id,
        transportPhase: a.phase,
        connectionElapsedMs: Math.max(0, this.now() - a.start),
        stageTimings: { ...a.timings },
      };
    const host = session ? this.hosts.get(session) : undefined;
    const { spawned: _spawned, alive: _alive, ...fields } = host ?? {};
    return {
      ...fields,
      ...(a && !a.finished && a.hostSession === session
        ? {
            shareAttempt: a.id,
            transportPhase: a.phase,
            connectionElapsedMs: Math.max(0, this.now() - a.start),
            stageTimings: { ...a.timings },
          }
        : {}),
    };
  }
  private emit(name: string, native: Native = {}) {
    try {
      this.sink({
        name,
        native: { ...native, ...this.snapshot(native.hostSession) },
      });
    } catch {
      /* Recording never controls capture. */
    }
  }
  spawn(session: string, pid: number | undefined, trigger: Trigger) {
    const previous = this.current;
    this.current = session;
    this.generation++;
    const host = {
      hostSession: session,
      previousHostSession: previous,
      hostPid: pid,
      hostGeneration: this.generation,
      hostRestartCount: this.generation - 1,
      hostTrigger: trigger,
      spawned: this.now(),
      alive: true,
    };
    if (this.attempt && !this.attempt.finished) {
      this.attempt.hostSession = session;
      Object.assign(host, { shareAttempt: this.attempt.id });
    }
    this.hosts.set(session, host);
    while (this.hosts.size > 16)
      this.hosts.delete(this.hosts.keys().next().value!);
    this.emit("native-host-spawn", host);
    if (previous) this.emit("native-host-rebuild", host);
  }
  ready(session: string) {
    const host = this.hosts.get(session);
    if (!host) return;
    host.hostReadyMs = Math.max(0, this.now() - host.spawned);
    this.emit("native-host-ready", this.snapshot(session));
  }
  exit(
    session: string,
    reason: string,
    code: number | null,
    signal?: string | null,
  ) {
    const host = this.hosts.get(session);
    if (!host) return;
    host.alive = false;
    this.emit("native-host-exit", {
      ...this.snapshot(session),
      hostExitReason: reason,
      ...(code === null ? {} : { hostExitCode: code }),
      ...(signal ? { hostSignal: signal } : {}),
    });
  }
  beginShare() {
    const now = this.now();
    this.attempt = {
      id: randomUUID(),
      start: now,
      finished: false,
      hostSession:
        this.current && this.hosts.get(this.current)?.alive
          ? this.current
          : undefined,
      phase: "none",
      phaseStart: now,
      timings: {},
    };
    const host = this.attempt.hostSession
      ? this.hosts.get(this.attempt.hostSession)
      : undefined;
    if (host) host.shareAttempt = this.attempt.id;
    this.emit("native-share-start");
    return this.attempt.id;
  }
  endShare(result: "stopped" | "failed" | "cancelled", native: Native = {}) {
    if (!this.attempt || this.attempt.finished) return;
    this.emit(`native-share-${result}`, native);
    this.attempt.finished = true;
  }
  phase(session: string, phase: Phase) {
    if (
      session !== this.current ||
      session !== this.attempt?.hostSession ||
      !this.attempt ||
      this.attempt.finished ||
      ["none", "setup", "http", "answer", "ice", "dtls", "connected"].indexOf(
        phase,
      ) <=
        ["none", "setup", "http", "answer", "ice", "dtls", "connected"].indexOf(
          this.attempt.phase,
        )
    )
      return;
    const a = this.attempt,
      previous = a.phase,
      duration = Math.max(0, this.now() - a.phaseStart);
    if (previous !== "none" && previous !== "connected")
      a.timings[`${previous}Ms`] = duration;
    a.phase = phase;
    a.phaseStart = this.now();
    if (phase === "connected")
      a.timings.totalMs = Math.max(0, this.now() - a.start);
    this.emit("native-transport-phase", {
      hostSession: session,
      transportPhase: phase,
      previousPhase: previous,
      phaseDurationMs: duration,
    });
  }
  network(session: string, raw: unknown) {
    const network = decodeNativeNetwork(raw);
    if (!network) {
      this.emit("native-network-invalid", { hostSession: session });
      return;
    }
    const key = `${session}:${network.sequence}:${network.method}`;
    if (this.networkSeen.has(key)) return network;
    this.networkSeen.add(key);
    while (this.networkSeen.size > 256)
      this.networkSeen.delete(this.networkSeen.values().next().value!);
    this.emit("native-network-result", {
      hostSession: session,
      ...(network.method === "POST"
        ? {
            network,
            transportErrorCode: network.curlCode,
            transportHttpStatus: network.httpStatus,
          }
        : { cleanupNetwork: network }),
    });
    return network;
  }
  record(name: string, native: Native = {}) {
    this.emit(name, native);
  }
}
