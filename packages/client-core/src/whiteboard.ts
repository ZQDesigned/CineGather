import type {
  BoardEdit,
  BoardElement,
  BoardElementInput,
  BoardOperation,
  WhiteboardDocument,
} from "@cinegather/contracts";
export function emptyWhiteboard(): WhiteboardDocument {
  return { revision: 0, elements: [], undo: [], redo: [] };
}
export function editWhiteboard(
  input: WhiteboardDocument,
  operation: BoardOperation,
  actor: string,
): WhiteboardDocument {
  const board = structuredClone(input);
  const revision = board.revision + 1;
  if (operation.type === "clear") return { ...emptyWhiteboard(), revision };
  let before: BoardElement | undefined, after: BoardElement | undefined;
  if (operation.type === "put") {
    before = board.elements.find((e) => e.id === operation.element.id);
    if (
      before
        ? before.version !== operation.expectedVersion
        : operation.expectedVersion !== undefined
    )
      throw Error("这部分白板已被修改，请重试");
    if (!before && board.elements.length >= 500)
      throw Error("白板内容已满，请先整理画布");
    after = {
      ...operation.element,
      authorId: before?.authorId ?? actor,
      version: revision,
    };
  } else if (operation.type === "remove") {
    before = board.elements.find((e) => e.id === operation.elementId);
    if (!before || before.version !== operation.expectedVersion)
      throw Error("这部分白板已被修改，请重试");
  } else {
    const stack = operation.type === "undo" ? board.undo : board.redo;
    let index = stack.length - 1;
    while (index >= 0 && stack[index]!.actor !== actor) index--;
    if (index < 0) throw Error("没有可撤销或重做的操作");
    const edit = stack[index]!;
    const expected = operation.type === "undo" ? edit.after : edit.before;
    const current = board.elements.find(
      (e) => e.id === (edit.after ?? edit.before)!.id,
    );
    if (expected ? current?.version !== expected.version : !!current)
      throw Error("其他成员已修改此内容，无法覆盖");
    before = current;
    const target = operation.type === "undo" ? edit.before : edit.after;
    after = target ? { ...target, version: revision } : undefined;
    stack.splice(index, 1);
    // Restoring a historical value creates a fresh revision. Rebase only this
    // actor's exact links to that value; a collaborator's later edit still fences undo.
    if (target && after)
      for (const entry of [...board.undo, ...board.redo]) {
        if (entry.actor !== actor) continue;
        if (
          entry.before?.id === target.id &&
          entry.before.version === target.version
        )
          entry.before = { ...entry.before, version: revision };
        if (
          entry.after?.id === target.id &&
          entry.after.version === target.version
        )
          entry.after = { ...entry.after, version: revision };
      }
    const reverse: BoardEdit =
      operation.type === "undo"
        ? { actor, before: after, after: before }
        : { actor, before, after };
    (operation.type === "undo" ? board.redo : board.undo).push(reverse);
  }
  const id = (after ?? before)!.id;
  board.elements = board.elements.filter((e) => e.id !== id);
  if (after) board.elements.push(after);
  if (operation.type === "put" || operation.type === "remove") {
    board.undo.push({ actor, before, after });
    board.redo = board.redo.filter((e) => e.actor !== actor);
  }
  board.undo = board.undo.slice(-200);
  board.redo = board.redo.slice(-200);
  board.revision = revision;
  if (JSON.stringify(board).length > 2_000_000)
    throw Error("白板内容过多，请先整理画布");
  return board;
}

export function boardCursorColor(userId: string) {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ["#7952b3", "#167d8d", "#b14569", "#a16b16", "#28764f", "#4369b0"][
    Math.abs(hash) % 6
  ]!;
}

export function boardLiveDraft(
  input: BoardElementInput,
  expectedVersion?: number,
) {
  const {
    authorId: _author,
    version: _version,
    ...element
  } = input as BoardElement;
  return { element, expectedVersion };
}
