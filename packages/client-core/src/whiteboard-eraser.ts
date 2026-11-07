import type { BoardElement } from "@cinegather/contracts";
import { boardStrokePolyline } from "./whiteboard-stroke";
type Point = readonly [number, number];
function distance(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  const t = length
    ? Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length),
      )
    : 0;
  return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
}
function near(a: Point, b: Point, c: Point, d: Point, radius: number) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const intersects =
    Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
      Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
    Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
      Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) &&
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0;
  return (
    intersects ||
    Math.min(
      distance(a, c, d),
      distance(b, c, d),
      distance(c, a, b),
      distance(d, a, b),
    ) <=
      radius * radius
  );
}
/** Sweep a finite-radius eraser between samples, so fast movement cannot skip objects. */
export function boardSweepHits(
  elements: BoardElement[],
  from: Point,
  to: Point,
  radius: number,
) {
  return elements.filter((e) => {
    const reach =
      radius + (e.kind === "path" || e.kind === "rect" ? e.strokeWidth / 2 : 0);
    if (e.kind === "path") {
      const points = boardStrokePolyline(e.points).map(
        ([x, y]) => [x + e.x, y + e.y] as Point,
      );
      return points.some((p, i) =>
        near(from, to, points[Math.max(0, i - 1)]!, p, reach),
      );
    }
    const corners: Point[] = [
      [e.x, e.y],
      [e.x + e.width, e.y],
      [e.x + e.width, e.y + e.height],
      [e.x, e.y + e.height],
    ];
    const inside = (p: Point) =>
      p[0] >= e.x &&
      p[0] <= e.x + e.width &&
      p[1] >= e.y &&
      p[1] <= e.y + e.height;
    return (
      (e.kind !== "rect" && (inside(from) || inside(to))) ||
      corners.some((p, i) => near(from, to, p, corners[(i + 1) % 4]!, reach))
    );
  });
}
