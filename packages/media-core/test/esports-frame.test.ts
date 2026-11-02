import { expect, test } from "bun:test";
import { waitForEsportsFrame } from "../src/esports-frame";
class Video extends EventTarget {
  readyState = 2;
  videoWidth = 1920;
  currentTime = 0;
  frames = 0;
  getVideoPlaybackQuality() {
    return { totalVideoFrames: this.frames };
  }
}
test("subscription and metadata alone are insufficient: prewarming waits for a decoded video frame", async () => {
  const video = new Video(),
    abort = new AbortController();
  let ready = false;
  const waiting = waitForEsportsFrame(
    video as unknown as HTMLVideoElement,
    abort.signal,
  ).then(() => (ready = true));
  video.dispatchEvent(new Event("loadedmetadata"));
  await Bun.sleep(1);
  expect(ready).toBe(false);
  video.frames = 1;
  video.currentTime = 0.033;
  video.dispatchEvent(new Event("loadeddata"));
  await waiting;
  expect(ready).toBe(true);
});
test("an aborted first-frame wait is released without leaking a warming observer", async () => {
  const video = new Video(),
    abort = new AbortController();
  const waiting = waitForEsportsFrame(
    video as unknown as HTMLVideoElement,
    abort.signal,
  );
  abort.abort();
  await expect(waiting).rejects.toThrow();
  video.frames = 1;
  video.dispatchEvent(new Event("loadeddata"));
});
