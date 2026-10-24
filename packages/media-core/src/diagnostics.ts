import { rtcStatSchema, type MediaDiagnostic } from "@cinegather/contracts";
export async function diagnosticHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`cinegather-diagnostics-v1:${value}`),
  );
  return Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export function projectRTCStats(report: RTCStatsReport) {
  const rows: ReturnType<typeof rtcStatSchema.parse>[] = [];
  const relevantCodecs = new Set<string>();
  report.forEach((stat) => {
    if (stat.codecId) relevantCodecs.add(stat.codecId);
  });
  const priority = [
    "inbound-rtp",
    "outbound-rtp",
    "remote-inbound-rtp",
    "remote-outbound-rtp",
    "transport",
    "candidate-pair",
    "media-source",
    "codec",
  ];
  const all: Record<string, unknown>[] = [];
  report.forEach((stat) => all.push(stat));
  all.sort(
    (a, b) =>
      priority.indexOf(String(a.type)) - priority.indexOf(String(b.type)),
  );
  all.forEach((stat) => {
    if (
      ![
        "inbound-rtp",
        "outbound-rtp",
        "remote-inbound-rtp",
        "remote-outbound-rtp",
        "candidate-pair",
        "transport",
        "codec",
        "media-source",
      ].includes(String(stat.type))
    )
      return;
    if (stat.type === "codec" && !relevantCodecs.has(String(stat.id))) return;
    const safe: Record<string, unknown> = { ...stat };
    if (stat.type === "candidate-pair") {
      const local = report.get(String(stat.localCandidateId)),
        remote = report.get(String(stat.remoteCandidateId));
      safe.localCandidateType = local?.candidateType;
      safe.remoteCandidateType = remote?.candidateType;
      safe.transportProtocol = local?.protocol;
      safe.relayProtocol = local?.relayProtocol;
    }
    const parsed = rtcStatSchema.safeParse(safe);
    if (parsed.success && rows.length < 32) rows.push(parsed.data);
  });
  return rows;
}
export async function boundedStats(
  work: () => Promise<RTCStatsReport | undefined>,
  timeoutMs = 1200,
): Promise<{
  status: MediaDiagnostic["tracks"][number]["status"];
  stats: ReturnType<typeof projectRTCStats>;
}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work().then((report) => ({
        status: report ? ("ok" as const) : ("unavailable" as const),
        stats: report ? projectRTCStats(report) : [],
      })),
      new Promise<{ status: "timeout"; stats: [] }>((resolve) => {
        timer = setTimeout(
          () => resolve({ status: "timeout", stats: [] }),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    return { status: "failed", stats: [] };
  } finally {
    clearTimeout(timer);
  }
}

export class PlaybackProbe {
  private element?: HTMLVideoElement;
  private stream?: MediaProvider | null;
  private callback?: number;
  private lastFrame?: number;
  private maxGap = 0;
  private callbacks = 0;
  private metadata?: VideoFrameCallbackMetadata;
  private events: string[] = [];
  private event = (event: Event) => {
    if (this.events.length < 32) this.events.push(`video-${event.type}`);
  };
  bind(element?: HTMLVideoElement) {
    if (this.element === element) return;
    if (this.element) {
      if (this.callback !== undefined)
        this.element.cancelVideoFrameCallback?.(this.callback);
      for (const name of [
        "waiting",
        "stalled",
        "playing",
        "pause",
        "emptied",
        "error",
        "resize",
      ])
        this.element.removeEventListener(name, this.event);
    }
    this.element = element;
    this.stream = undefined;
    this.lastFrame = undefined;
    this.metadata = undefined;
    this.maxGap = 0;
    this.callbacks = 0;
    if (!element) return;
    for (const name of [
      "waiting",
      "stalled",
      "playing",
      "pause",
      "emptied",
      "error",
      "resize",
    ])
      element.addEventListener(name, this.event);
    const frame = (now: number, metadata: VideoFrameCallbackMetadata) => {
      if (this.element !== element) return;
      if (this.stream !== element.srcObject) {
        this.stream = element.srcObject;
        this.lastFrame = undefined;
        this.maxGap = 0;
        this.callbacks = 0;
      }
      if (this.lastFrame !== undefined)
        this.maxGap = Math.max(this.maxGap, now - this.lastFrame);
      this.lastFrame = now;
      this.metadata = metadata;
      this.callbacks++;
      this.callback = element.requestVideoFrameCallback(frame);
    };
    this.callback = element.requestVideoFrameCallback?.(frame);
  }
  takeEvents() {
    return this.events.splice(0);
  }
  sample() {
    const video = this.element;
    if (!video) return;
    const quality = video.getVideoPlaybackQuality?.(),
      metadata = this.metadata;
    const sample = {
      clientWidth: video.clientWidth,
      clientHeight: video.clientHeight,
      readyState: video.readyState,
      paused: video.paused,
      ended: video.ended,
      hidden: document.hidden,
      width: video.videoWidth,
      height: video.videoHeight,
      currentTime: video.currentTime,
      playbackRate: video.playbackRate,
      totalFrames: quality?.totalVideoFrames,
      droppedFrames: quality?.droppedVideoFrames,
      presentedFrames: metadata?.presentedFrames,
      frameAgeMs:
        this.lastFrame === undefined
          ? undefined
          : performance.now() - this.lastFrame,
      maxFrameGapMs: this.maxGap,
      callbackCount: this.callbacks,
      processingDuration: metadata?.processingDuration,
      presentationDelayMs:
        metadata?.presentationTime === undefined
          ? undefined
          : performance.now() - metadata.presentationTime,
      expectedDisplayDelayMs:
        metadata?.expectedDisplayTime === undefined
          ? undefined
          : metadata.expectedDisplayTime - metadata.presentationTime,
      captureToReceiveMs:
        metadata?.captureTime !== undefined &&
        metadata.receiveTime !== undefined
          ? metadata.receiveTime - metadata.captureTime
          : undefined,
      receiveToPresentMs:
        metadata?.receiveTime === undefined
          ? undefined
          : metadata.presentationTime - metadata.receiveTime,
      mediaTime: metadata?.mediaTime,
    };
    this.maxGap = 0;
    this.callbacks = 0;
    return sample;
  }
}
