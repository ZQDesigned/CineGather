import { expect, test } from "bun:test";
import {
  boardStrokePath,
  boardStrokePolyline,
  appendBoardSamples,
} from "../src/whiteboard-stroke";
import { boardSweepHits } from "../src/whiteboard-eraser";
test("freehand corners become bounded smooth curves without changing recorded coordinates", () => {
  const points: [number, number][] = [
    [0.25, 0.5],
    [100, 0.5],
    [100, 100],
  ];
  const original = structuredClone(points);
  expect(boardStrokePath(points)).toContain("Q");
  expect(boardStrokePath(points)).toStartWith("M0.25 0.5");
  expect(points).toEqual(original);
  const rendered = boardStrokePolyline(points);
  expect(rendered[0]).toEqual(points[0]);
  expect(rendered.at(-1)).toEqual(points.at(-1));
  expect(
    rendered.every(([x, y]) => x >= 0.25 && x <= 100 && y >= 0.5 && y <= 100),
  ).toBe(true);
  expect(boardStrokePath([])).toBe("");
  expect(boardStrokePath([[4, 5]])).toBe("M4 5 L4 5");
  expect(
    boardStrokePath([
      [1, 2],
      [3, 4],
    ]),
  ).toBe("M1 2 L3 4");
});
test("eraser follows the displayed curve rather than its original sharp corner", () => {
  const shape = {
    id: crypto.randomUUID(),
    kind: "path" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    color: "#123456",
    strokeWidth: 0.1,
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
    ] as [number, number][],
    authorId: "a",
    version: 1,
  };
  expect(boardSweepHits([shape], [87.5, 12.5], [87.5, 12.5], 0.5)).toHaveLength(
    1,
  );
  expect(boardSweepHits([shape], [100, 0], [100, 0], 0.5)).toHaveLength(0);
});
test("dense samples preserve fractions and endpoints while remaining within the wire point budget", () => {
  const points: [number, number][] = [[0.125, 0.375]];
  appendBoardSamples(points, [
    [0.125, 0.375],
    [1.25, 2.75],
  ]);
  expect(points).toEqual([
    [0.125, 0.375],
    [1.25, 2.75],
  ]);
  appendBoardSamples(
    points,
    Array.from({ length: 4000 }, (_, i) => [i + 0.25, i + 0.75]),
  );
  expect(points.length).toBeLessThanOrEqual(1024);
  expect(points[0]).toEqual([0.125, 0.375]);
  expect(points.at(-1)).toEqual([3999.25, 3999.75]);
});
