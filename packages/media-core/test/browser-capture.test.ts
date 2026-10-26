import { expect, test } from "bun:test";
import { BrowserCapture } from "../src/browser-capture";

function stream(surface = "browser", audio = true, isolated = false) {
  const video = {
    kind: "video",
    readyState: "live",
    contentHint: "",
    getSettings: () => ({ displaySurface: surface }),
    stop() {
      this.readyState = "ended";
    },
  };
  const sound = {
    kind: "audio",
    readyState: "live",
    getSettings: () => ({ restrictOwnAudio: isolated }),
    stop() {
      this.readyState = "ended";
    },
  };
  let tracks = audio ? [video, sound] : [video];
  return {
    value: {
      getTracks: () => tracks,
      getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
      getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
      removeTrack: (track: unknown) => {
        tracks = tracks.filter((t) => t !== track);
      },
    } as unknown as MediaStream,
    video,
    sound,
  };
}

test("browser display capture starts synchronously on the confirmation gesture, and stops late grants after cancellation", async () => {
  let finish!: (value: MediaStream) => void;
  let started = false;
  const capture = new BrowserCapture(() => {
    started = true;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const selected = capture.select("cinema", true);
  expect(started).toBe(true);
  capture.stop();
  const late = stream();
  finish(late.value);
  expect(await selected).toBe(false);
  expect(late.video.readyState).toBe("ended");
  expect(late.sound.readyState).toBe("ended");
  expect(capture.current).toBeUndefined();
});

test("browser shares tab audio, but discards unisolated system audio to prevent room playback echo", async () => {
  for (const surface of ["monitor", "window", "browser"]) {
    const source = stream(surface);
    let options: DisplayMediaStreamOptions | undefined;
    const capture = new BrowserCapture(async (request) => {
      options = request;
      return source.value;
    });
    expect(await capture.select("game", true)).toBe(true);
    expect(options).toMatchObject({
      systemAudio: "exclude",
      selfBrowserSurface: "exclude",
    });
    expect(source.value.getAudioTracks()).toHaveLength(
      surface === "browser" ? 1 : 0,
    );
    expect(capture.audioNotice).toBeDefined();
    if (surface === "browser") expect(capture.audioNotice).toBe("");
    else expect(source.sound.readyState).toBe("ended");
    capture.stop();
    expect(source.video.readyState).toBe("ended");
  }
});

test("verified own-page audio isolation allows system audio, while missing audio still leaves video usable", async () => {
  const isolated = stream("monitor", true, true);
  const capture = new BrowserCapture(
    async () => isolated.value,
    () => true,
  );
  await capture.select("cinema", true);
  expect(capture.current?.getAudioTracks()).toHaveLength(1);
  expect(capture.audioNotice).toBe("");
  capture.stop();
  const videoOnly = stream("window", false);
  const fallback = new BrowserCapture(async () => videoOnly.value);
  expect(await fallback.select("cinema", true)).toBe(true);
  expect(fallback.current?.getVideoTracks()).toHaveLength(1);
  expect(fallback.audioNotice).toContain("仅共享画面");
  fallback.stop();
});

test("sound is never retained when sharing without audio and malformed captures release all tracks", async () => {
  const source = stream();
  const capture = new BrowserCapture(async () => source.value);
  await capture.select("cinema", false);
  expect(source.sound.readyState).toBe("ended");
  capture.stop();
  const broken = stream();
  broken.value.removeTrack(broken.video as unknown as MediaStreamTrack);
  const invalid = new BrowserCapture(async () => broken.value);
  await expect(invalid.select("cinema", true)).rejects.toThrow("画面");
  expect(broken.sound.readyState).toBe("ended");
});

test("a replacement picker keeps the current stream alive until commit and cancel preserves it", async () => {
  const first = stream(),
    second = stream();
  let next = first.value;
  const capture = new BrowserCapture(async () => next);
  await capture.select("cinema", true);
  next = second.value;
  await capture.select("cinema", true, true);
  expect(capture.current).toBe(first.value);
  expect(first.video.readyState).toBe("live");
  expect(capture.selected).toBe(second.value);
  capture.cancelSelection();
  expect(second.video.readyState).toBe("ended");
  expect(capture.current).toBe(first.value);
  const third = stream();
  next = third.value;
  await capture.select("cinema", true, true);
  capture.commitSelection();
  expect(capture.current).toBe(third.value);
  expect(first.video.readyState).toBe("ended");
  capture.stop();
});
