export type SingingOptions = {
  gain: number;
  reverb: number;
  monitor: number;
  delayMs: number;
};
const clamp = (
  v: number | undefined,
  min: number,
  max: number,
  fallback: number,
) =>
  v !== undefined && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : fallback;
export function singingOptions(
  v: Partial<SingingOptions> = {},
): SingingOptions {
  return {
    gain: clamp(v.gain, 0, 2, 1),
    reverb: clamp(v.reverb, 0, 0.3, 0),
    monitor: clamp(v.monitor, 0, 0.5, 0),
    delayMs: clamp(v.delayMs, 0, 200, 0),
  };
}
export const singingConstraints = (headphones: boolean) => ({
  echoCancellation: !headphones,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 48000,
});
export const karaokePlayoutTarget = (singing: boolean) =>
  singing ? 0.01 : 0.06;
type Counter = {
  timestamp: number;
  delay?: number;
  count?: number;
  concealed?: number;
  total?: number;
};
export interface KaraokeMeasurement {
  transportRttMs?: number;
  queueMs?: number;
  concealedPercent?: number;
}
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
// Component measurements, deliberately not an estimate of mouth-to-ear latency.
export class KaraokeAudioMetrics {
  private previous = new Map<string, Counter>();
  sample(
    key: string,
    stats: ReadonlyArray<Record<string, unknown>>,
  ): KaraokeMeasurement {
    const result: KaraokeMeasurement = {};
    for (const s of stats) {
      if (
        s.type === "candidate-pair" &&
        s.nominated === true &&
        finite(s.currentRoundTripTime)
      )
        result.transportRttMs = s.currentRoundTripTime * 1000;
      if (
        s.type !== "inbound-rtp" ||
        (s.kind !== "audio" && s.mediaType !== "audio")
      )
        continue;
      if (!finite(s.timestamp)) continue;
      const next: Counter = {
        timestamp: s.timestamp,
        delay: finite(s.jitterBufferDelay) ? s.jitterBufferDelay : undefined,
        count: finite(s.jitterBufferEmittedCount)
          ? s.jitterBufferEmittedCount
          : undefined,
        concealed: finite(s.concealedSamples) ? s.concealedSamples : undefined,
        total: finite(s.totalSamplesReceived)
          ? s.totalSamplesReceived
          : undefined,
      };
      const id = key + ":" + String(s.id ?? "audio"),
        previous = this.previous.get(id);
      if (previous && next.timestamp <= previous.timestamp) continue;
      this.previous.set(id, next);
      if (this.previous.size > 128)
        this.previous.delete(this.previous.keys().next().value!);
      if (!previous) continue;
      if (
        next.count !== undefined &&
        previous.count !== undefined &&
        next.delay !== undefined &&
        previous.delay !== undefined &&
        next.count > previous.count &&
        next.delay >= previous.delay
      )
        result.queueMs =
          ((next.delay - previous.delay) / (next.count - previous.count)) *
          1000;
      if (
        next.total !== undefined &&
        previous.total !== undefined &&
        next.concealed !== undefined &&
        previous.concealed !== undefined &&
        next.total > previous.total &&
        next.concealed >= previous.concealed
      )
        result.concealedPercent = Math.min(
          100,
          ((next.concealed - previous.concealed) /
            (next.total - previous.total)) *
            100,
        );
    }
    return result;
  }
  clear() {
    this.previous.clear();
  }
}

export function requestKaraokeBuffer(
  receiver:
    | { jitterBufferTarget?: number | null; playoutDelayHint?: number }
    | undefined,
  seconds?: number,
) {
  if (!receiver) return false;
  let applied = false;
  if ("jitterBufferTarget" in receiver)
    try {
      receiver.jitterBufferTarget =
        seconds === undefined ? null : Math.max(0, Math.min(1, seconds)) * 1000;
      applied = true;
    } catch {
      /* Unsupported or read-only receiver. */
    }
  if ("playoutDelayHint" in receiver)
    try {
      receiver.playoutDelayHint = seconds;
      applied = true;
    } catch {
      /* Keep the browser's default buffering. */
    }
  return applied;
}
