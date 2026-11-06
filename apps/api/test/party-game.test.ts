import { expect, test } from "bun:test";
import {
  newPartyGame,
  partyCommand,
  partyView,
  tickPartyGame,
} from "../src/party-game";
const names = [
  { id: "a", name: "甲" },
  { id: "b", name: "乙" },
  { id: "c", name: "丙" },
];
function ready(kind: "draw" | "quiz") {
  let game = newPartyGame(kind);
  for (const p of names)
    game = partyCommand(game, p, { type: "ready", ready: true }, 1000);
  return partyCommand(game, names[0]!, { type: "start" }, 1000);
}
test("drawing word choices and answer are only visible to the current drawer", () => {
  let game = ready("draw");
  expect(partyView(game, "b", 1000).choices).toBeUndefined();
  expect(partyView(game, "a", 1000).choices?.length).toBe(3);
  game = partyCommand(game, names[0]!, { type: "choose", index: 0 }, 1200);
  expect(partyView(game, "a", 1200).answer).toBeTruthy();
  expect(partyView(game, "b", 1200).answer).toBeUndefined();
  expect(JSON.stringify(partyView(game, "b", 1200))).not.toContain(
    game.word!.answer,
  );
});
test("only server judged correct answers earn points and duplicate guesses earn nothing", () => {
  let game = ready("quiz");
  const answer = game.word!.answer;
  game = partyCommand(game, names[0]!, { type: "guess", answer }, 2000);
  expect(game.players[0]!.score).toBe(100);
  expect(() =>
    partyCommand(game, names[0]!, { type: "guess", answer }, 2100),
  ).toThrow();
  game = partyCommand(game, names[1]!, { type: "guess", answer }, 2200);
  expect(game.players[1]!.score).toBe(80);
});
test("timeout reveals an answer, then advances without client clock input", () => {
  let game = ready("quiz");
  game = tickPartyGame(game, game.deadline! + 1);
  expect(game.phase).toBe("results");
  expect(partyView(game, "a", game.deadline!).answer).toBeTruthy();
  game = tickPartyGame(game, game.deadline! + 1);
  expect(game.round).toBe(2);
  expect(partyView(game, "a", game.deadline! - 1).answer).toBeUndefined();
});

test("repeating ready does not postpone an active player's eligibility", () => {
  const game = ready("quiz");
  const again = partyCommand(
    game,
    names[0]!,
    { type: "ready", ready: true },
    1500,
  );
  expect(again.players[0]!.eligibleRound).toBe(game.players[0]!.eligibleRound);
  expect(
    partyCommand(
      again,
      names[0]!,
      { type: "guess", answer: again.word!.answer },
      2000,
    ).players[0]!.score,
  ).toBe(100);
});
