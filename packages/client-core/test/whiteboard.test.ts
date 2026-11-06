import { expect, test } from "bun:test";
import { editWhiteboard, emptyWhiteboard } from "../src/whiteboard";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const element = {
  id: a,
  kind: "path" as const,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  color: "#123456",
  strokeWidth: 3,
  points: [
    [1, 2],
    [4, 8],
  ] as [number, number][],
};
test("undo only removes the actor's edit and keeps another member's stroke", () => {
  let board = editWhiteboard(emptyWhiteboard(), { type: "put", element }, a);
  board = editWhiteboard(
    board,
    { type: "put", element: { ...element, id: b } },
    b,
  );
  board = editWhiteboard(board, { type: "undo" }, a);
  expect(board.elements.map((e) => e.id)).toEqual([b]);
  board = editWhiteboard(board, { type: "redo" }, a);
  expect(board.elements.map((e) => e.id).sort()).toEqual([a, b]);
});
test("stale object edits and undo cannot overwrite another member's change", () => {
  let board = editWhiteboard(emptyWhiteboard(), { type: "put", element }, a);
  board = editWhiteboard(
    board,
    { type: "put", element: { ...element, x: 40 }, expectedVersion: 1 },
    b,
  );
  expect(() =>
    editWhiteboard(board, { type: "put", element, expectedVersion: 1 }, a),
  ).toThrow();
  expect(() => editWhiteboard(board, { type: "undo" }, a)).toThrow();
  expect(board.elements[0]!.x).toBe(40);
});
test("reusing an element id does not silently replace its contents", () => {
  const board = editWhiteboard(emptyWhiteboard(), { type: "put", element }, a);
  expect(() => editWhiteboard(board, { type: "put", element }, b)).toThrow();
});
test("successive own edits can be undone and redone without overwriting a later collaborator", () => {
  let board = editWhiteboard(emptyWhiteboard(), { type: "put", element }, a);
  board = editWhiteboard(
    board,
    { type: "put", element: { ...element, x: 40 }, expectedVersion: 1 },
    a,
  );
  board = editWhiteboard(board, { type: "undo" }, a);
  board = editWhiteboard(board, { type: "undo" }, a);
  expect(board.elements).toHaveLength(0);
  board = editWhiteboard(board, { type: "redo" }, a);
  board = editWhiteboard(board, { type: "redo" }, a);
  expect(board.elements[0]!.x).toBe(40);
  board = editWhiteboard(
    board,
    {
      type: "put",
      element: { ...element, x: 80 },
      expectedVersion: board.elements[0]!.version,
    },
    b,
  );
  expect(() => editWhiteboard(board, { type: "undo" }, a)).toThrow();
});
