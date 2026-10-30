import type { DiagnosticStat, MediaDiagnostic } from "@cinegather/contracts";
export type VideoHealthKind =
  | "checking"
  | "smooth"
  | "few-updates"
  | "network"
  | "decode"
  | "render"
  | "unavailable"
  | "paused";
export interface VideoHealthStatus {
  kind: VideoHealthKind;
  receivedFps?: number;
  decodedFps?: number;
  presentedFps?: number;
  lostPercent?: number;
  jitterMs?: number;
  decodeMs?: number;
}
interface Input {
  track?: string;
  at: number;
  watching: boolean;
  visible: boolean;
  paused?: boolean;
  stats?: Partial<DiagnosticStat>;
  playback?: MediaDiagnostic["playback"];
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const shown = (p: Input["playback"]) =>
  p?.presentedFrames ??
  p?.callbackCount ??
  (finite(p?.totalFrames)
    ? Math.max(0, p.totalFrames - (p?.droppedFrames ?? 0))
    : undefined);
export class VideoHealth {
  private previous?: Input;
  private candidate?: VideoHealthKind;
  private since = 0;
  private result?: VideoHealthStatus;
  reset() {
    this.previous = undefined;
    this.candidate = undefined;
    this.result = undefined;
    this.since = 0;
  }
  sample(input: Input): VideoHealthStatus | undefined {
    if (!input.watching || !input.visible || input.paused || !input.track) {
      this.reset();
      return input.watching ? { kind: "paused" } : undefined;
    }
    const before = this.previous,
      elapsed = before ? input.at - before.at : 0;
    if (
      !before ||
      before.track !== input.track ||
      elapsed > 6500 ||
      elapsed < 0
    ) {
      this.reset();
      this.previous = input;
      return (this.result = { kind: "checking" });
    }
    if (elapsed < 750) return this.result;
    this.previous = input;
    const delta = (value: number | undefined, old: number | undefined) =>
      finite(value) && finite(old) ? value - old : undefined;
    const received = delta(
        input.stats?.framesReceived,
        before.stats?.framesReceived,
      ),
      decoded = delta(input.stats?.framesDecoded, before.stats?.framesDecoded),
      presented = delta(shown(input.playback), shown(before.playback));
    const packets = delta(
        input.stats?.packetsReceived,
        before.stats?.packetsReceived,
      ),
      lost = delta(input.stats?.packetsLost, before.stats?.packetsLost);
    if (
      [received, decoded, presented, packets, lost].some(
        (x) => x !== undefined && x < 0,
      )
    ) {
      this.candidate = undefined;
      return (this.result = { kind: "checking" });
    }
    const rate = (v: number | undefined) =>
      v === undefined ? undefined : (v * 1000) / elapsed;
    const metrics: Omit<VideoHealthStatus, "kind"> = {
      receivedFps: rate(received),
      decodedFps: rate(decoded),
      presentedFps: rate(presented),
      lostPercent:
        packets !== undefined && lost !== undefined && packets + lost > 0
          ? (lost / (packets + lost)) * 100
          : undefined,
      jitterMs: finite(input.stats?.jitter)
        ? input.stats.jitter * 1000
        : undefined,
    };
    const decodeTime = delta(
      input.stats?.totalDecodeTime,
      before.stats?.totalDecodeTime,
    );
    if (decoded && decodeTime !== undefined && decodeTime >= 0)
      metrics.decodeMs = (decodeTime / decoded) * 1000;
    const receivedFps = metrics.receivedFps,
      decodedFps = metrics.decodedFps,
      presentedFps = metrics.presentedFps;
    const stalled =
      (presentedFps ?? 0) < 8 || (input.playback?.frameAgeMs ?? 0) > 750;
    let kind: VideoHealthKind;
    if (decodedFps === undefined || presentedFps === undefined)
      kind = "unavailable";
    else if (
      stalled &&
      ((metrics.lostPercent ?? 0) >= 5 || (metrics.jitterMs ?? 0) >= 60)
    )
      kind = "network";
    else if (
      receivedFps !== undefined &&
      receivedFps >= 12 &&
      (decodedFps < receivedFps * 0.5 ||
        ((metrics.decodeMs ?? 0) > 65 && stalled))
    )
      kind = "decode";
    else if (decodedFps >= 12 && presentedFps < decodedFps * 0.5)
      kind = "render";
    // Sparse/static source updates are neutral. Receiver stats alone cannot prove
    // whether the sharer, upstream network or unchanged source caused low FPS.
    else if (Math.max(receivedFps ?? 0, decodedFps, presentedFps) < 8)
      kind = "few-updates";
    else kind = "smooth";
    if (kind === "unavailable") {
      this.candidate = undefined;
      return (this.result = { kind, ...metrics });
    }
    if (this.candidate !== kind) {
      this.candidate = kind;
      this.since = input.at;
    }
    const hold = kind === "smooth" ? 2000 : 4000;
    const confirmed = input.at - this.since >= hold;
    return (this.result = {
      kind: confirmed ? kind : (this.result?.kind ?? "checking"),
      ...metrics,
    });
  }
}
