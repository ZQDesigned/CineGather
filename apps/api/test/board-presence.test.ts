import { test, expect } from "bun:test";
import { allowBoardPresence } from "../src/modules/activities/board-presence";
import type {
  ActivitySnapshot,
  BoardPresenceInput,
} from "@cinegather/contracts";
const snapshot: ActivitySnapshot = {
  roomId: "room",
  generation: 3,
  revision: 1,
  kind: "board",
  ownerId: "owner",
  starterId: "starter",
  requests: [],
  permissions: [],
  board: {
    elements: [],
    revision: 0,
    canUndo: false,
    canRedo: false,
    canEdit: false,
    editorIds: ["starter"],
  },
};
const frame: BoardPresenceInput = {
  generation: 3,
  cursor: { x: 12, y: 33 },
  draft: {
    element: {
      id: "stroke",
      kind: "path",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: "#112233",
      strokeWidth: 3,
      points: [[12, 33]],
    },
  },
};
test("spectator cursors are allowed but cannot forge drawing previews", () => {
  expect(allowBoardPresence(snapshot, { ...frame, draft: null })).toBe(true);
  expect(allowBoardPresence(snapshot, frame)).toBe(false);
  expect(
    allowBoardPresence(
      { ...snapshot, board: { ...snapshot.board!, canEdit: true } },
      frame,
    ),
  ).toBe(true);
  expect(
    allowBoardPresence(snapshot, { ...frame, generation: 2, draft: null }),
  ).toBe(false);
  expect(
    allowBoardPresence(
      { ...snapshot, kind: "idle" },
      { ...frame, draft: null },
    ),
  ).toBe(false);
});
test("previews cannot introduce foreign image references or overwrite a later committed edit", () => {
  const editable = {
    ...snapshot,
    board: { ...snapshot.board!, canEdit: true },
  };
  expect(
    allowBoardPresence(editable, {
      ...frame,
      draft: {
        element: { ...frame.draft!.element, kind: "image", imageId: "foreign" },
      },
    }),
  ).toBe(false);
  const committed = {
    ...frame.draft!.element,
    version: 2,
    authorId: "starter",
  };
  expect(
    allowBoardPresence(
      { ...editable, board: { ...editable.board, elements: [committed] } },
      frame,
    ),
  ).toBe(false);
  expect(
    allowBoardPresence(
      { ...editable, board: { ...editable.board, elements: [committed] } },
      { ...frame, draft: { ...frame.draft!, expectedVersion: 2 } },
    ),
  ).toBe(true);
});
