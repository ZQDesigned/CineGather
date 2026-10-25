import {
  rtcStatSchema,
  playbackSchema,
  projectDiagnosticObject,
  type DiagnosticIssue,
  type MediaDiagnostic,
} from "@cinegather/contracts";
export async function diagnosticHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`cinegather-diagnostics-v1:${value}`),
  );
  return Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export function projectRTCStats(
  report: RTCStatsReport,
  issue: (value: DiagnosticIssue) => void = () => {},
) {
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
    const safe: Record<string, unknown> = Object.create(stat);
    if (stat.type === "candidate-pair") {
      const local = report.get(String(stat.localCandidateId)),
        remote = report.get(String(stat.remoteCandidateId));
      safe.localCandidateType = local?.candidateType;
      safe.remoteCandidateType = remote?.candidateType;
      safe.transportProtocol = local?.protocol;
      safe.relayProtocol = local?.relayProtocol;
    }
    if (rows.length < 32)
      rows.push(
        projectDiagnosticObject(
          rtcStatSchema,
          safe,
          "rtc",
          "media.tracks.stats",
          issue,
        ),
      );
  });
  return rows;
}
export async function boundedStats(
  work: () => Promise<RTCStatsReport | undefined>,
  timeoutMs = 1200,
  issue: (value: DiagnosticIssue) => void = () => {},
): Promise<{
  status: MediaDiagnostic["tracks"][number]["status"];
  stats: ReturnType<typeof projectRTCStats>;
}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(work)
        .then((report) => ({
          status: report ? ("ok" as const) : ("unavailable" as const),
          stats: report ? projectRTCStats(report, issue) : [],
        })),
      new Promise<{ status: "timeout"; stats: [] }>((resolve) => {
        timer = setTimeout(() => {
          issue({ stage: "rtc", code: "timeout", field: "media.tracks.stats" });
          resolve({ status: "timeout", stats: [] });
        }, timeoutMs);
      }),
    ]);
  } catch {
    issue({ stage: "rtc", code: "read-failed", field: "media.tracks.stats" });
    return { status: "failed", stats: [] };
  } finally {
    clearTimeout(timer);
  }
}

export class PlaybackProbe {
  private issues: DiagnosticIssue[] = [];
  takeIssues() {
    return this.issues.splice(0);
  }
  private issue = (issue: DiagnosticIssue) => {
    if (this.issues.length < 64) this.issues.push(issue);
  };
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
    let quality: VideoPlaybackQuality | undefined;
    try {
      quality = video.getVideoPlaybackQuality?.();
    } catch {
      this.issue({
        stage: "playback",
        code: "read-failed",
        field: "media.playback.totalFrames",
      });
    }
    const metadata = this.metadata;
    const { lastFrame, maxGap, callbacks } = this;
    const raw = {
      get clientWidth() {
        return video.clientWidth;
      },
      get clientHeight() {
        return video.clientHeight;
      },
      get readyState() {
        return video.readyState;
      },
      get paused() {
        return video.paused;
      },
      get ended() {
        return video.ended;
      },
      get hidden() {
        return globalThis.document?.hidden ?? false;
      },
      get width() {
        return video.videoWidth;
      },
      get height() {
        return video.videoHeight;
      },
      get currentTime() {
        return video.currentTime;
      },
      get playbackRate() {
        return video.playbackRate;
      },
      get totalFrames() {
        return quality?.totalVideoFrames;
      },
      get droppedFrames() {
        return quality?.droppedVideoFrames;
      },
      get presentedFrames() {
        return metadata?.presentedFrames;
      },
      get frameAgeMs() {
        return lastFrame === undefined
          ? undefined
          : performance.now() - lastFrame;
      },
      get maxFrameGapMs() {
        return maxGap;
      },
      get callbackCount() {
        return callbacks;
      },
      get processingDuration() {
        return metadata?.processingDuration;
      },
      get presentationDelayMs() {
        return metadata?.presentationTime === undefined
          ? undefined
          : performance.now() - metadata.presentationTime;
      },
      get expectedDisplayDelayMs() {
        return metadata?.expectedDisplayTime === undefined
          ? undefined
          : metadata.expectedDisplayTime - metadata.presentationTime;
      },
      get captureToReceiveMs() {
        return metadata?.captureTime !== undefined &&
          metadata.receiveTime !== undefined
          ? metadata.receiveTime - metadata.captureTime
          : undefined;
      },
      get receiveToPresentMs() {
        return metadata?.receiveTime === undefined
          ? undefined
          : metadata.presentationTime - metadata.receiveTime;
      },
      get mediaTime() {
        return metadata?.mediaTime;
      },
    };
    const sample = projectDiagnosticObject(
      playbackSchema,
      raw,
      "playback",
      "media.playback",
      this.issue,
    );
    this.maxGap = 0;
    this.callbacks = 0;
    return sample;
  }
}
