import { expect, test } from "bun:test";
import { MediaSession } from "../src/session";

test("diagnostics measure the local preview without binding the movie player or changing its stream", async () => {
  class Video extends EventTarget {
    srcObject: MediaProvider | null = null;
    muted = true;
    paused = false;
    ended = false;
    readyState = 4;
    currentTime = 2;
    playbackRate = 1;
    clientWidth = 800;
    clientHeight = 450;
    plays = 0;
    constructor(
      public videoWidth: number,
      public videoHeight: number,
      private frames: number,
    ) {
      super();
    }
    play() {
      this.plays++;
      return Promise.resolve();
    }
    getVideoPlaybackQuality() {
      return { totalVideoFrames: this.frames, droppedVideoFrames: 0 };
    }
  }
  const media = new MediaSession(
    () => {},
    () => {},
    () => {},
  );
  const remote = new Video(1280, 720, 30),
    preview = new Video(1920, 1080, 120);
  const stream = {} as MediaStream;
  preview.srcObject = stream;
  media.setVideoElement(remote as unknown as HTMLVideoElement);
  media.setPreviewVideoElement(preview as unknown as HTMLVideoElement);
  expect((await media.detailedDiagnostics()).playback).toMatchObject({
    width: 1920,
    height: 1080,
    totalFrames: 120,
  });
  expect(preview.srcObject).toBe(stream);
  expect(preview.plays).toBe(0);
  expect(preview.muted).toBe(true);
  media.setPreviewVideoElement(undefined);
  expect((await media.detailedDiagnostics()).playback).toMatchObject({
    width: 1280,
    height: 720,
    totalFrames: 30,
  });
  media.setVideoElement(undefined);
  await media.disconnect();
});
