import { expect, test } from "bun:test";
import { newPartyGame, partyCommand } from "../src/modules/party/party-game";
import { firstCorrectAnswer } from "../src/modules/party/party-learning-model";
import { submissionEligibility } from "@cinegather/contracts";

test("submission requires strictly more than seven days and fifty first-try questions", () => {
  const day = 86_400_000,
    registered = new Date(0);
  expect(submissionEligibility(registered, 50, 7 * day).eligible).toBe(false);
  expect(submissionEligibility(registered, 49, 7 * day + 1).eligible).toBe(
    false,
  );
  expect(submissionEligibility(registered, 50, 7 * day + 1).eligible).toBe(
    true,
  );
  expect(submissionEligibility(registered, 70, 6 * day).eligible).toBe(false);
});
for (const kind of ["draw", "quiz"] as const) {
  test(`${kind} only counts a valid first guess, never a later correction or replay`, () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({
      answer: "题" + i,
      category: "测试",
      clues: ["一", "二", "三"],
    }));
    let game = newPartyGame(kind, pool);
    for (const id of ["a", "b"])
      game = partyCommand(
        game,
        { id, name: id },
        { type: "ready", ready: true },
        10000,
      );
    game = partyCommand(game, { id: "a", name: "a" }, { type: "start" }, 10000);
    if (kind === "draw")
      game = partyCommand(
        game,
        { id: game.drawerId!, name: "画手" },
        { type: "choose", index: 0 },
        10000,
      );
    const guesser = kind === "draw" ? (game.drawerId === "a" ? "b" : "a") : "a";
    const actor = { id: guesser, name: guesser };
    const correct = partyCommand(
      game,
      actor,
      { type: "guess", answer: game.word!.answer },
      10001,
    );
    expect(firstCorrectAnswer(game, correct, guesser)).toBe(game.word!.answer);
    expect(firstCorrectAnswer(correct, correct, guesser)).toBeUndefined();
    const wrong = partyCommand(
      game,
      actor,
      { type: "guess", answer: "错误" },
      10001,
    );
    expect(firstCorrectAnswer(game, wrong, guesser)).toBeUndefined();
    const fixed = partyCommand(
      wrong,
      actor,
      { type: "guess", answer: game.word!.answer },
      11001,
    );
    expect(firstCorrectAnswer(wrong, fixed, guesser)).toBeUndefined();
  });
}
