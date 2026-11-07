type Point = readonly [number, number];
const midpoint = (a: Point, b: Point): [number, number] => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
];
// Midpoint quadratics remain inside the sampled stroke's bounds; no overshoot.
function segments(points: readonly Point[]): { end: Point; control?: Point }[] {
  const result: { end: Point; control?: Point }[] = [];
  if (points.length < 3) return points.slice(1).map((end) => ({ end }));
  result.push({ end: midpoint(points[0]!, points[1]!) });
  for (let i = 1; i < points.length - 1; i++)
    result.push({
      control: points[i]!,
      end: midpoint(points[i]!, points[i + 1]!),
    });
  result.push({ end: points.at(-1)! });
  return result;
}
export function boardStrokePath(points: readonly Point[] = []) {
  if (!points.length) return "";
  const first = points[0]!;
  return (
    `M${first[0]} ${first[1]} ` +
    (points.length === 1
      ? `L${first[0]} ${first[1]}`
      : segments(points)
          .map((s) =>
            s.control
              ? `Q${s.control[0]} ${s.control[1]} ${s.end[0]} ${s.end[1]}`
              : `L${s.end[0]} ${s.end[1]}`,
          )
          .join(" "))
  );
}
/** Flatten the very same curve for hit testing, with <= 0.25 board-unit error. */
export function boardStrokePolyline(points: readonly Point[] = []): Point[] {
  if (!points.length) return [];
  const output: Point[] = [points[0]!];
  function flatten(a: Point, c: Point, b: Point, depth = 0) {
    if (
      depth >= 12 ||
      Math.hypot(a[0] - 2 * c[0] + b[0], a[1] - 2 * c[1] + b[1]) / 4 <= 0.25
    ) {
      output.push(b);
      return;
    }
    const ac = midpoint(a, c),
      cb = midpoint(c, b),
      m = midpoint(ac, cb);
    flatten(a, ac, m, depth + 1);
    flatten(m, cb, b, depth + 1);
  }
  for (const s of segments(points))
    if (s.control) flatten(output.at(-1)!, s.control, s.end);
    else output.push(s.end);
  return output;
}
/** Compact dense capture rather than freezing the pen at the 1024-point limit. */
export function appendBoardSamples(
  points: [number, number][],
  samples: readonly Point[],
) {
  for (const point of samples) {
    const last = points.at(-1);
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    if (points.length >= 1024) {
      const retained = points.filter(
        (_, i) => i % 2 === 0 || i === points.length - 1,
      );
      points.splice(0, points.length, ...retained);
    }
    points.push([point[0], point[1]]);
  }
}
