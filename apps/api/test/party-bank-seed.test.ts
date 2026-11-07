import { expect, test } from "bun:test";
import { partyWordSeed } from "../src/modules/party/party-word-seed";
import { partyWordInput, partyAnswerKey } from "@cinegather/contracts";
import {
  newPartyGame,
  partyCommand,
  partyView,
  tickPartyGame,
} from "../src/modules/party/party-game";
test("1650 unique usable seed questions with three distinct progressive clues", () => {
  expect(partyWordSeed).toHaveLength(1650);
  expect(new Set(partyWordSeed.map((w) => partyAnswerKey(w.answer))).size).toBe(
    1650,
  );
  for (const word of partyWordSeed) {
    expect(partyWordInput.safeParse({ ...word, enabled: true }).success).toBe(
      true,
    );
    expect(new Set(word.clues).size).toBe(3);
  }
});

test("modern game pack has curated clues and explicit drawing suitability", async () => {
  const { partyModernGameWords } = await import(
    "../src/modules/party/data/party-modern-game-words"
  );
  expect(partyModernGameWords).toHaveLength(150);
  expect(
    Object.fromEntries(
      [...new Set(partyModernGameWords.map((w) => w.category))].map(
        (category) => [
          category,
          partyModernGameWords.filter((w) => w.category === category).length,
        ],
      ),
    ),
  ).toEqual({
    明日方舟: 35,
    王者荣耀: 20,
    原神: 25,
    "崩坏：星穹铁道": 25,
    无畏契约: 20,
    三角洲行动: 15,
    和平精英: 10,
  });
  for (const w of partyModernGameWords) {
    expect(w.modes).toContain("quiz");
    for (const clue of w.clues) {
      expect(
        partyAnswerKey(clue).includes(partyAnswerKey(w.answer)),
        w.answer,
      ).toBe(false);
      expect(clue.includes(w.category), w.answer).toBe(false);
    }
  }
  for (const answer of ["理智", "公开招募", "零号大坝", "烽火地带", "超体对抗"])
    expect(
      partyModernGameWords.find((w) => w.answer === answer)?.modes,
    ).toEqual(["quiz"]);
  for (const answer of ["阿米娅", "能天使", "可莉", "帕姆", "吉利服"])
    expect(
      partyModernGameWords.find((w) => w.answer === answer)?.modes,
    ).toContain("draw");
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

test("authored clues add information beyond the category instead of a generic type label", () => {
  const generic =
    /^(?:它|这)?是(?:一(?:种|个|处|套))?(?:职业|乐器|植物|动物|家具|工具|用品|物品|动作|场所|电器|设备|食物)[。！]?$/;
  for (const word of partyWordSeed) {
    for (const clue of word.clues) {
      expect(generic.test(clue), `${word.answer}: ${clue}`).toBe(false);
      expect(
        clue
          .replace(/^(?:它|这)?是(?:一(?:种|个|处|套))?/, "")
          .replace(/[。！]$/, ""),
        word.answer,
      ).not.toBe(word.category);
    }
  }
});

test("expanded bank spans many themes, targets compatible games, and never spells out the answer in new clues", async () => {
  const { partyWordExpansion } = await import("../src/modules/party/data/party-word-expansion");
  expect(partyWordExpansion).toHaveLength(1100);
  expect(
    new Set(partyWordSeed.map((w) => w.category)).size,
  ).toBeGreaterThanOrEqual(40);
  expect(
    partyWordExpansion.filter((w) => w.category.startsWith("游戏")).length,
  ).toBeGreaterThanOrEqual(150);
  expect(
    partyWordSeed.filter((w) => !w.modes || w.modes.includes("draw")).length,
  ).toBeGreaterThanOrEqual(1000);
  expect(
    partyWordSeed.filter(
      (w) => w.modes?.length === 1 && w.modes.includes("quiz"),
    ).length,
  ).toBeGreaterThan(100);
  for (const w of partyWordExpansion)
    for (const clue of w.clues)
      expect(clue.includes(w.answer), w.answer).toBe(false);
});
