import type { PartyGame } from "./party-game";

/** Called only after a successful, server-authorized guess, with the pre-command ticked state. */
export function firstCorrectAnswer(
  before: PartyGame,
  after: PartyGame,
  userId: string,
) {
  if (
    before.phase !== "playing" ||
    !before.word ||
    before.round !== after.round ||
    before.solvedIds.includes(userId) ||
    Object.hasOwn(before.lastGuesses, userId) ||
    !after.solvedIds.includes(userId)
  )
    return undefined;
  return before.word.answer;
}
