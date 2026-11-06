import { expect, test } from "bun:test";
import { partyWordSeed } from "../src/party-word-seed";
import { partyWordInput, partyAnswerKey } from "@cinegather/contracts";
import {
  newPartyGame,
  partyCommand,
  partyView,
  tickPartyGame,
} from "../src/party-game";
test("400 unique usable seed questions with three distinct progressive clues", () => {
  expect(partyWordSeed).toHaveLength(400);
  expect(new Set(partyWordSeed.map((w) => partyAnswerKey(w.answer))).size).toBe(
    400,
  );
  for (const word of partyWordSeed) {
    expect(partyWordInput.safeParse({ ...word, enabled: true }).success).toBe(
      true,
    );
    expect(new Set(word.clues).size).toBe(3);
  }
});
test("a game retains its question pool without exposing it to players", () => {
  const pool = partyWordSeed.slice(30, 33).map((w) => structuredClone(w));
  let game = newPartyGame("draw", pool);
  const a = { id: "a", name: "甲" },
    b = { id: "b", name: "乙" };
  for (const p of [a, b])
    game = partyCommand(game, p, { type: "ready", ready: true }, 1000);
  game = partyCommand(game, a, { type: "start" }, 1000);
  const choices = game.choices.map((w) => w.answer);
  pool[0]!.answer = "changed outside";
  expect(game.choices.map((w) => w.answer)).toEqual(choices);
  expect(partyView(game, "b", 1000)).not.toHaveProperty("wordPool");
  expect(partyView(game, "b", 1000)).not.toHaveProperty("choices");
  game = tickPartyGame(game, game.deadline! + 1);
  expect(choices).toContain(game.word!.answer);
});
