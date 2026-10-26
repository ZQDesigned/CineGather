import { expect, test } from "bun:test";
import { Accompaniment } from "../src/accompaniment";
function fixture() {
  let capture!: (value: MediaStreamTrack) => void;
  const tracks: string[] = [],
    stopped: string[] = [];
  const subject = new Accompaniment({
    capture: () =>
      new Promise((resolve) => {
        capture = resolve;
      }),
    stopCapture: async () => {
      stopped.push("capture");
    },
    publish: async (track) => {
      tracks.push(track.id);
    },
    unpublish: async (track) => {
      stopped.push(track.id);
    },
    volume: () => {},
    changed: () => {},
  });
  return {
    subject,
    tracks,
    stopped,
    resolve: (id: string) =>
      capture({
        id,
        stop: () => stopped.push(id),
      } as unknown as MediaStreamTrack),
  };
}
test("late application grants cannot publish after leaving or starting our own screen share", async () => {
  const f = fixture();
  const task = f.subject.start("music");
  await Bun.sleep(0);
  await f.subject.stop();
  f.resolve("old");
  await task;
  expect(f.tracks).toEqual([]);
  expect(f.stopped).toContain("old");
});
test("accompaniment can be explicitly restarted after our share starts, but stopping it never stops the screen share", async () => {
  const f = fixture();
  const first = f.subject.start("music");
  await Bun.sleep(0);
  f.resolve("a");
  await first;
  await f.subject.stop();
  const second = f.subject.start("music");
  await Bun.sleep(0);
  f.resolve("b");
  await second;
  expect(f.tracks).toEqual(["a", "b"]);
  expect(f.stopped).toContain("a");
  expect(f.subject.active).toBe(true);
  await f.subject.stop();
  expect(f.stopped).toContain("b");
});
