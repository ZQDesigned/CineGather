import { cpus, freemem, totalmem, loadavg } from "node:os";
import { readFile } from "node:fs/promises";
import { diagnosticServerSchema } from "@cinegather/contracts";
const metricNames = new Set([
  "livekit_packet_total",
  "livekit_packet_bytes",
  "livekit_nack_total",
  "livekit_pli_total",
  "livekit_fir_total",
  "livekit_packet_loss_total",
  "livekit_forward_latency",
  "livekit_forward_latency_ns_sum",
  "livekit_forward_latency_ns_count",
  "livekit_node_packet_total",
]);
export function parseSfuMetrics(text: string) {
  const grouped = new Map<
    string,
    {
      name: string;
      direction?: "incoming" | "outgoing";
      transmission?: "initial" | "retransmit";
      type?: "out" | "dropped";
      value: number;
    }
  >();
  for (const line of text.split("\n")) {
    const match = /^([a-z_]+)(?:\{([^}]*)\})?\s+([-+\deE.]+)(?:\s|$)/.exec(
      line,
    );
    if (!match || !metricNames.has(match[1]!)) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    const labels = match[2] ?? "",
      direction = /\bdirection="(incoming|outgoing)"/.exec(labels)?.[1] as
        | "incoming"
        | "outgoing"
        | undefined,
      transmission = /\btransmission="(initial|retransmit)"/.exec(
        labels,
      )?.[1] as "initial" | "retransmit" | undefined,
      type = /\btype="(out|dropped)"/.exec(labels)?.[1] as
        | "out"
        | "dropped"
        | undefined;
    const key = [match[1], direction, transmission, type].join(":");
    const previous = grouped.get(key);
    if (previous) previous.value += value;
    else if (grouped.size < 128)
      grouped.set(key, {
        name: match[1]!,
        direction,
        transmission,
        type,
        value,
      });
  }
  return [...grouped.values()];
}
export function parseNetworkCounters(text: string) {
  const lines = text.trim().split("\n"),
    values: Record<string, number> = {};
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const header = lines[i]!.trim().split(/\s+/),
      row = lines[i + 1]!.trim().split(/\s+/);
    if (header[0] !== row[0]) continue;
    for (let j = 1; j < header.length; j++) {
      const n = Number(row[j]);
      if (Number.isFinite(n)) values[`${header[0]}${header[j]}`] = n;
    }
  }
  return {
    udpInErrors: values["Udp:InErrors"],
    udpReceiveBufferErrors: values["Udp:RcvbufErrors"],
    udpSendBufferErrors: values["Udp:SndbufErrors"],
    tcpRetransmittedSegments: values["Tcp:RetransSegs"],
  };
}
export class ServerDiagnostics {
  private cache?: {
    at: number;
    value: ReturnType<typeof diagnosticServerSchema.parse>;
  };
  private pending?: Promise<ReturnType<typeof diagnosticServerSchema.parse>>;
  private previous = this.cpu();
  constructor(private url = process.env.LIVEKIT_METRICS_URL) {}
  private cpu() {
    const cores = cpus();
    return {
      idle: cores.reduce((n, c) => n + c.times.idle, 0),
      total: cores.reduce(
        (n, c) => n + Object.values(c.times).reduce((a, b) => a + b, 0),
        0,
      ),
    };
  }
  async snapshot() {
    if (!this.cache || Date.now() - this.cache.at > 5000) {
      this.pending ??= this.collect()
        .then((value) => {
          this.cache = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          this.pending = undefined;
        });
      await this.pending;
    }
    return { ...this.cache!.value, capturedAt: Date.now() };
  }
  private async collect() {
    const current = this.cpu(),
      elapsed = current.total - this.previous.total,
      idle = current.idle - this.previous.idle;
    this.previous = current;
    let sfuStatus: "available" | "unconfigured" | "unavailable" = this.url
      ? "unavailable"
      : "unconfigured";
    let sfu: ReturnType<typeof parseSfuMetrics> | undefined;
    if (this.url)
      try {
        const response = await fetch(this.url, {
          signal: AbortSignal.timeout(1500),
          redirect: "error",
        });
        if (!response.ok || !response.body) throw new Error("unavailable");
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let text = "",
          bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > 1024 * 1024) throw new Error("too large");
            text += decoder.decode(part.value, { stream: true });
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        sfu = parseSfuMetrics(text);
        sfuStatus = sfu.length ? "available" : "unavailable";
      } catch {
        /* Optional instrumentation must not break the ordinary diagnostics endpoint. */
      }
    const network =
      process.platform === "linux"
        ? await readFile("/proc/net/snmp", "utf8")
            .then(parseNetworkCounters)
            .catch(() => undefined)
        : undefined;
    return diagnosticServerSchema.parse({
      sampledAt: Date.now(),
      cpuPercent: elapsed > 0 ? (1 - idle / elapsed) * 100 : undefined,
      freeMemory: freemem(),
      totalMemory: totalmem(),
      load1: loadavg()[0],
      processRss: process.memoryUsage().rss,
      network,
      sfuStatus,
      sfu,
    });
  }
}
