import { expect, test } from "bun:test";
import { boardSweepHits } from "../src/whiteboard-eraser";
import { editWhiteboard, emptyWhiteboard } from "../src/whiteboard";
import type { BoardElement } from "@cinegather/contracts";
const stroke = (id: string, x: number): BoardElement => ({
  id,
  kind: "path",
  x,
  y: 0,
  width: 1,
  height: 1,
  color: "#112233",
  strokeWidth: 3,
  points: [
    [0, 0],
    [0, 100],
  ],
  authorId: "a",
  version: 1,
});
test("a fast sweep crosses every stroke even when both pointer samples are in empty space", () => {
  const elements = [
    stroke("one", 20),
    stroke("two", 50),
    stroke("three", 80),
    stroke("miss", 150),
  ];
  expect(
    boardSweepHits(elements, [0, 50], [100, 50], 2).map((e) => e.id),
  ).toEqual(["one", "two", "three"]);
  expect(boardSweepHits(elements, [0, 120], [100, 120], 2)).toEqual([]);
});
test("eraser respects translated paths, stroke width, outlined rectangles and filled objects", () => {
  const rect = {
    ...stroke("rect", 40),
    kind: "rect" as const,
    y: 40,
    width: 60,
    height: 60,
  };
  expect(boardSweepHits([rect], [60, 60], [80, 80], 2)).toEqual([]);
  expect(boardSweepHits([rect], [0, 60], [60, 60], 2)).toHaveLength(1);
  expect(
    boardSweepHits([{ ...rect, kind: "note" }], [60, 60], [80, 80], 2),
  ).toHaveLength(1);
  expect(
    boardSweepHits(
      [{ ...stroke("dot", 20), points: [[0, 50]], strokeWidth: 10 }],
      [14, 50],
      [14, 50],
      2,
    ),
  ).toHaveLength(1);
});
test("batched erase is atomic, version-fenced and retains undo for each erased object", () => {
  const board = {
    ...emptyWhiteboard(),
    revision: 1,
    elements: [stroke("one", 20), stroke("two", 50)],
  };
  const erased = editWhiteboard(
    board,
    {
      type: "erase",
      elements: [
        { elementId: "one", expectedVersion: 1 },
        { elementId: "two", expectedVersion: 1 },
      ],
    },
    "a",
  );
  expect(erased.elements).toHaveLength(0);
  expect(
    editWhiteboard(erased, { type: "undo" }, "a").elements.map((e) => e.id),
  ).toEqual(["two"]);
  expect(() =>
    editWhiteboard(
      board,
      {
        type: "erase",
        elements: [
          { elementId: "one", expectedVersion: 1 },
          { elementId: "two", expectedVersion: 2 },
        ],
      },
      "a",
    ),
  ).toThrow();
  expect(board.elements).toHaveLength(2);
});
