import { expect, test } from "bun:test";
import { pointsPolicyInput } from "@cinegather/contracts";
import { pointsDay, awardedAmount } from "../src/modules/points/model";
import {
  newPartyGame,
  partyCommand,
  tickPartyGame,
} from "../src/modules/party/party-game";

test("daily points use Beijing midnight, independent of host timezone", () => {
  expect(pointsDay(new Date("2026-11-09T15:59:59.999Z"))).toBe("2026-11-09");
  expect(pointsDay(new Date("2026-11-09T16:00:00Z"))).toBe("2026-11-10");
});
test("cap truncates atomically without negative amounts when cap decreases", () => {
  expect(awardedAmount(10, 95, 100)).toBe(5);
  expect(awardedAmount(10, 100, 100)).toBe(0);
  expect(awardedAmount(5, 100, 50)).toBe(0);
});
test("policies reject odd first awards, forged games and unsafe values", () => {
  const rules = {
    enabled: true,
    dailyCap: 100,
    games: {
      "party.draw": { firstCorrect: 10, painter: 5 },
      "party.quiz": { firstCorrect: 10, painter: 0 },
    },
    version: 1,
    reason: "调整奖励",
  };
  expect(pointsPolicyInput.safeParse(rules).success).toBe(true);
  expect(pointsPolicyInput.safeParse({ ...rules, dailyCap: -1 }).success).toBe(
    false,
  );
  expect(
    pointsPolicyInput.safeParse({
      ...rules,
      games: { ...rules.games, "party.draw": { firstCorrect: 11, painter: 5 } },
    }).success,
  ).toBe(false);
  expect(
    pointsPolicyInput.safeParse({
      ...rules,
      games: { ...rules.games, mahjong: { firstCorrect: 10 } },
    }).success,
  ).toBe(false);
});
function playing() {
  let game = newPartyGame("quiz");
  for (const id of ["a", "b"])
    game = partyCommand(
      game,
      { id, name: id },
      { type: "ready", ready: true },
      10000,
    );
  return partyCommand(game, { id: "a", name: "a" }, { type: "start" }, 10000);
}
test("only accepted guesses count, throttles and replays cannot increase attempts", () => {
  const a = { id: "a", name: "a" },
    game = playing();
  const wrong = partyCommand(
    game,
    a,
    { type: "guess", answer: "wrong" },
    10001,
  );
  expect(wrong.guessAttempts?.a).toBe(1);
  expect(() =>
    partyCommand(wrong, a, { type: "guess", answer: game.word!.answer }, 10002),
  ).toThrow();
  expect(wrong.guessAttempts?.a).toBe(1);
  const right = partyCommand(
    wrong,
    a,
    { type: "guess", answer: game.word!.answer },
    11000,
  );
  expect(right.guessAttempts?.a).toBe(2);
  expect(() =>
    partyCommand(right, a, { type: "guess", answer: game.word!.answer }, 12000),
  ).toThrow();
});
test("new rounds and replayed games use different server identities", () => {
  let game = playing();
  const first = game.roundId;
  expect(first).toBeString();
  game = tickPartyGame(game, game.deadline!);
  expect(game.roundCompleted).toBe(true);
  game = tickPartyGame(game, game.deadline!);
  expect(game.roundId).not.toBe(first);
  expect(game.guessAttempts).toEqual({});
});

test("legacy in-progress games acquire settlement identities on their next round", () => {
  let game = playing();
  delete game.matchId;
  delete game.roundId;
  game = tickPartyGame(game, game.deadline!);
  game = tickPartyGame(game, game.deadline!);
  expect(game.matchId).toBeString();
  expect(game.roundId).toBeString();
});
