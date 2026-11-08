import type {
  ActivitySnapshot,
  BoardPresenceInput,
} from "@cinegather/contracts";
// Ephemeral previews never grant document access or replace committed elements.
export function allowBoardPresence(
  snapshot: ActivitySnapshot,
  frame: BoardPresenceInput,
) {
  if (
    snapshot.generation !== frame.generation ||
    !snapshot.board ||
    !(snapshot.kind === "board" || snapshot.game?.kind === "draw")
  )
    return false;
  if (!frame.draft) return true;
  if (!snapshot.board.canEdit) return false;
  const { element, expectedVersion } = frame.draft;
  const existing = snapshot.board.elements.find((e) => e.id === element.id);
  if (
    existing
      ? existing.version !== expectedVersion
      : expectedVersion !== undefined
  )
    return false;
  if (element.imageId && element.imageId !== existing?.imageId) return false;
  return true;
}

// Clearing already-seen transient state carries no drawing content. Deliver it
// during permission refresh too; fresh cursors/drafts still need current access.
export function allowBoardPresenceDelivery(
  authorizedGeneration: number | undefined,
  knownGeneration: number | undefined,
  frame: { generation: number; left?: true },
) {
  return (
    (frame.left ? knownGeneration : authorizedGeneration) === frame.generation
  );
}
