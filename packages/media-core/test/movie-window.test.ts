import { test, expect } from "bun:test";
import { MoviePlayback } from "../src/movie";
import type { Track, RemoteAudioTrack } from "livekit-client";
test("moving presentation detaches both movie tracks before binding the new clock", () => {
  const calls: string[] = [];
  const element = (name: string) =>
    ({
      name,
      muted: true,
      play: async () => {},
    }) as unknown as HTMLVideoElement;
  const main = element("main"),
    child = element("child");
  const fake = (kind: string) => ({
    attach: (e: HTMLVideoElement) =>
      calls.push(`attach ${kind} ${(e as unknown as { name: string }).name}`),
    detach: (e: HTMLVideoElement) =>
      calls.push(`detach ${kind} ${(e as unknown as { name: string }).name}`),
  });
  const movie = new MoviePlayback();
  movie.bind(main);
  movie.tracks(
    fake("video") as unknown as Track,
    fake("audio") as unknown as RemoteAudioTrack,
  );
  calls.length = 0;
  movie.bind(child);
  expect(calls).toEqual([
    "detach video main",
    "detach audio main",
    "attach video child",
    "attach audio child",
  ]);
  expect(child.muted).toBe(false);
  calls.length = 0;
  movie.bind(main);
  expect(calls).toEqual([
    "detach video child",
    "detach audio child",
    "attach video main",
    "attach audio main",
  ]);
});
