import { expect, test } from "bun:test";
import { FirstVideoFrame } from "../src/first-frame";
test("a native renderer callback must belong to the current track and contain actual nonzero frame dimensions", async () => {
  let track = "new";
  const gate = new FirstVideoFrame(() => track),
    abort = new AbortController();
  let ready = false;
  const pending = gate.wait(abort.signal).then(() => (ready = true));
  gate.rendered("old", 1920, 1080);
  gate.rendered("new", 0, 1080);
  await Promise.resolve();
  expect(ready).toBe(false);
  gate.rendered("new", 1920, 1080);
  await pending;
  expect(ready).toBe(true);
  track = "next";
  let next = false;
  const waiting = gate.wait(abort.signal).then(() => (next = true));
  gate.rendered("new", 1920, 1080);
  await Promise.resolve();
  expect(next).toBe(false);
  gate.rendered("next", 1280, 720);
  await waiting;
});
test("packets and advertised resolution alone cannot satisfy the native decode fallback", async () => {
  const gate = new FirstVideoFrame(() => "video"),
    abort = new AbortController();
  let ready = false;
  const pending = gate.wait(abort.signal).then(() => (ready = true));
  gate.stats("video", [
    {
      type: "inbound-rtp",
      kind: "video",
      packetsReceived: 100,
      frameWidth: 1920,
      framesDecoded: 0,
    },
  ]);
  gate.stats("video", [
    { type: "outbound-rtp", kind: "video", framesDecoded: 100 },
  ]);
  await Promise.resolve();
  expect(ready).toBe(false);
  gate.stats("video", [
    { type: "inbound-rtp", kind: "video", framesDecoded: 1 },
  ]);
  await pending;
  expect(ready).toBe(true);
});
test("closing or aborting a native warming handle releases its wait without letting a late frame revive it", async () => {
  const gate = new FirstVideoFrame(() => "video"),
    abort = new AbortController();
  const pending = gate.wait(abort.signal);
  abort.abort();
  await expect(pending).rejects.toThrow();
  const next = gate.wait(new AbortController().signal);
  gate.close();
  await expect(next).rejects.toThrow();
  gate.rendered("video", 1920, 1080);
  await expect(gate.wait(new AbortController().signal)).rejects.toThrow();
});
