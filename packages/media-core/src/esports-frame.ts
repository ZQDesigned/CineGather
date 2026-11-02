export function waitForEsportsFrame(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number | undefined,
      finished = false;
    const events = ["loadeddata", "timeupdate", "playing"];
    const clean = () => {
      clearInterval(timer);
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
      for (const e of events) video.removeEventListener(e, check);
      signal.removeEventListener("abort", abort);
    };
    const done = () => {
      if (finished) return;
      finished = true;
      clean();
      resolve();
    };
    const check = () => {
      const quality = video.getVideoPlaybackQuality?.();
      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        (quality ? quality.totalVideoFrames > 0 : video.currentTime > 0)
      )
        done();
    };
    const abort = () => {
      if (finished) return;
      finished = true;
      clean();
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timer = setInterval(check, 100);
    for (const e of events) video.addEventListener(e, check);
    if (video.requestVideoFrameCallback)
      frame = video.requestVideoFrameCallback(() => {
        if (video.videoWidth > 0) done();
        else check();
      });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}
