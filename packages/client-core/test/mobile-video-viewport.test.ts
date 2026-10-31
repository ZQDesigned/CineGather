import { expect, test } from "bun:test";
import { MobileVideoViewport } from "../src/mobile-video-viewport";
const p = (id: number, x: number, y: number) => ({ id, x, y });

test("pinch keeps the off-centre focal point under the fingers", () => {
  const v = new MobileVideoViewport();
  v.resize(400, 200, 2);
  v.update([p(1, 50, 100), p(2, 150, 100)]);
  v.update([p(1, 0, 100), p(2, 200, 100)]);
  expect(v.value).toEqual({ scale: 2, x: 100, y: 0 });
});

test("dragging is bounded by actual fitted video, including letterboxing", () => {
  const v = new MobileVideoViewport();
  v.resize(400, 400, 2);
  v.update([p(1, 150, 200), p(2, 250, 200)]);
  v.update([p(1, 100, 200), p(2, 300, 200)]);
  v.update([p(2, 300, 200)]);
  v.update([p(2, 900, 900)]);
  expect(v.value).toEqual({ scale: 2, x: 200, y: 0 });
  v.update([p(2, -900, -900)]);
  expect(v.value).toEqual({ scale: 2, x: -200, y: 0 });
});

test("pinch clamps scale, cannot move the original image, and rebases pointer changes", () => {
  const v = new MobileVideoViewport();
  v.resize(400, 200, 2);
  v.update([p(1, 20, 20)]);
  v.update([p(1, 200, 100)]);
  expect(v.value).toEqual({ scale: 1, x: 0, y: 0 });
  v.update([p(1, 150, 100), p(2, 250, 100)]);
  v.update([p(1, -1000, 100), p(2, 1400, 100)]);
  expect(v.value).toEqual({ scale: 4, x: 0, y: 0 });
  v.update([p(2, 1400, 100)]);
  expect(v.value.x).toBe(0);
  v.update([p(2, 1430, 120)]);
  expect(v.value).toEqual({ scale: 4, x: 30, y: 20 });
  v.update([p(1, 195, 100), p(2, 205, 100)]);
  v.update([p(1, 199.9, 100), p(2, 200.1, 100)]);
  expect(v.value).toEqual({ scale: 1, x: 0, y: 0 });
});

test("double tap resets but dragging, long presses and multi-touch do not count as taps", () => {
  const v = new MobileVideoViewport();
  v.resize(400, 200, 2);
  v.zoom(2);
  v.update([p(1, 100, 100)], 1000);
  v.finish(1050);
  v.update([p(1, 105, 102)], 1200);
  v.finish(1250);
  expect(v.value.scale).toBe(1);
  v.zoom(2);
  v.update([p(1, 100, 100)], 2000);
  v.update([p(1, 150, 100)], 2050);
  v.finish(2100);
  v.update([p(1, 100, 100)], 2200);
  v.finish(2250);
  expect(v.value.scale).toBe(2);
  v.update([p(1, 100, 100)], 2300);
  v.finish(3000);
  v.update([p(1, 100, 100)], 3100);
  v.finish(3150);
  expect(v.value.scale).toBe(2);
  v.update([p(1, 100, 100), p(2, 200, 100)], 3200);
  v.update([p(1, 100, 100)], 3220);
  v.finish(3250);
  v.update([p(1, 100, 100)], 3300);
  v.finish(3350);
  expect(v.value.scale).toBe(2);
});

test("rotation and source aspect changes reset while identical layouts preserve zoom", () => {
  const v = new MobileVideoViewport();
  v.resize(400, 200, 2);
  v.zoom(3);
  v.resize(400, 200, 2);
  expect(v.value.scale).toBe(3);
  v.resize(200, 400, 2);
  expect(v.value).toEqual({ scale: 1, x: 0, y: 0 });
  v.zoom(3);
  v.resize(200, 400, 0.5);
  expect(v.value.scale).toBe(1);
});

test("cancellation and coincident fingers never create invalid transforms or false double taps", () => {
  const v = new MobileVideoViewport();
  v.resize(400, 200, 2);
  v.zoom(2);
  v.update([p(1, 100, 100)], 1000);
  v.cancel();
  v.update([p(1, 100, 100)], 1100);
  v.finish(1150);
  expect(v.value.scale).toBe(2);
  v.update([p(1, 100, 100), p(2, 100, 100)]);
  v.update([p(1, 0, 100), p(2, 200, 100)]);
  expect(Number.isFinite(v.value.x)).toBe(true);
  expect(v.value.scale).toBeLessThanOrEqual(4);
});
