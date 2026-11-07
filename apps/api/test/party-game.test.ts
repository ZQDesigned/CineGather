import { expect, test } from "bun:test";
import {
  newPartyGame,
  partyCommand,
  partyView,
  tickPartyGame,
} from "../src/modules/party/party-game";
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
test("correct answers track solved members without scores or duplicate guesses", () => {
  let game = ready("quiz");
  const answer = game.word!.answer;
  game = partyCommand(game, names[0]!, { type: "guess", answer }, 2000);
  expect(game.solvedIds).toEqual(["a"]);
  expect(game.players.some((p) => "score" in p)).toBe(false);
  expect(() =>
    partyCommand(game, names[0]!, { type: "guess", answer }, 2100),
  ).toThrow();
  game = partyCommand(game, names[1]!, { type: "guess", answer }, 2200);
  expect(game.solvedIds).toEqual(["a", "b"]);
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
    ).solvedIds,
  ).toEqual(["a"]);
});

for (const kind of ["draw", "quiz"] as const) {
  test(`${kind} finishes at the last valid round and can restart`, () => {
    let game = ready(kind);
    for (let step = 0; game.phase !== "finished" && step < 30; step++) {
      game = tickPartyGame(game, game.deadline! + 1);
      expect(game.round).toBeLessThanOrEqual(game.totalRounds);
    }
    expect(game.phase).toBe("finished");
    expect(game.round).toBe(game.totalRounds);
    expect(game.deadline).toBeUndefined();
    game = partyCommand(game, names[0]!, { type: "start" }, 999999);
    expect(game.round).toBe(1);
    expect(game.solvedIds).toEqual([]);
  });
}

test("legacy finished games expose a bounded round and no scores", () => {
  const game = ready("draw");
  game.phase = "finished";
  game.round = game.totalRounds + 1;
  Object.assign(game.players[0]!, { score: 120 });
  const view = partyView(game, "a", 2000);
  expect(view.round).toBe(view.totalRounds);
  expect(view.players.some((p) => "score" in p)).toBe(false);
});

test("drawer can reroll three times per turn with a server-enforced two-second cooldown and private choices", () => {
  let game = ready("draw");
  const deadline = game.deadline;
  let view = partyView(game, "a", 1000);
  expect(view.rerollsRemaining).toBe(3);
  expect(view.canReroll).toBe(true);
  expect(partyView(game, "b", 1000).rerollsRemaining).toBeUndefined();
  expect(() => partyCommand(game, names[1]!, { type: "reroll" }, 1000)).toThrow(
    "画手",
  );
  const seen = new Set(game.choices.map((w) => w.answer));
  for (let i = 0; i < 3; i++) {
    const now = 1000 + i * 2000;
    const oldRevision = view.choicesRevision;
    game = partyCommand(
      game,
      names[0]!,
      { type: "reroll", choicesRevision: oldRevision },
      now,
    );
    view = partyView(game, "a", now);
    expect(view.choices).toHaveLength(3);
    expect(view.choices!.some((w) => seen.has(w))).toBe(false);
    view.choices!.forEach((w) => seen.add(w));
    expect(view.rerollsRemaining).toBe(2 - i);
    expect(view.rerollAvailableAt).toBe(now + 2000);
    expect(view.choicesRevision).toBeGreaterThan(oldRevision!);
    expect(game.deadline).toBe(deadline);
    if (i < 2)
      expect(() =>
        partyCommand(game, names[0]!, { type: "reroll" }, now + 1999),
      ).toThrow("2 秒");
    expect(() =>
      partyCommand(
        game,
        names[0]!,
        { type: "choose", index: 0, choicesRevision: oldRevision },
        now,
      ),
    ).toThrow("题目已更新");
  }
  expect(() => partyCommand(game, names[0]!, { type: "reroll" }, 7000)).toThrow(
    "次数已用完",
  );
  game = partyCommand(
    game,
    names[0]!,
    { type: "choose", index: 0, choicesRevision: view.choicesRevision },
    7000,
  );
  expect(game.deadline).toBe(97000);
  expect(tickPartyGame(game, 96999).phase).toBe("playing");
  expect(tickPartyGame(game, 97000).phase).toBe("results");
  game = tickPartyGame(game, 97000);
  game = tickPartyGame(game, game.deadline!);
  expect(partyView(game, "b", game.deadline! - 1).rerollsRemaining).toBe(3);
});

test("reroll is unavailable after selection, during pause, to quiz players, or when no replacement set exists", () => {
  let game = ready("draw");
  const original = structuredClone(game);
  game = partyCommand(game, names[0]!, { type: "pause" }, 1200);
  expect(() =>
    partyCommand(game, names[0]!, { type: "reroll" }, 1300),
  ).toThrow();
  game = partyCommand(game, names[0]!, { type: "resume" }, 1400);
  game = partyCommand(game, names[0]!, { type: "choose", index: 0 }, 1500);
  expect(() =>
    partyCommand(game, names[0]!, { type: "reroll" }, 1600),
  ).toThrow();
  expect(() =>
    partyCommand(ready("quiz"), names[0]!, { type: "reroll" }, 1500),
  ).toThrow();
  expect(ready("quiz").deadline).toBe(46000);
  const small = { ...original, wordPool: original.choices };
  expect(partyView(small, "a", 1000).canReroll).toBe(false);
  expect(() =>
    partyCommand(small, names[0]!, { type: "reroll" }, 1000),
  ).toThrow("暂无更多题目");
  expect(small.rerollsUsed ?? 0).toBe(0);
  const auto = tickPartyGame(original, original.deadline!);
  expect(auto.deadline).toBe(original.deadline! + 90000);
  expect(partyView(auto, "a", 16000).rerollsRemaining).toBeUndefined();
});

test("all offered choices remain unseen across rounds and a new game until the bank is exhausted", () => {
  const pool = Array.from({ length: 60 }, (_, i) => ({
    answer: `word${i}`,
    category: `category${i % 6}`,
    clues: ["one", "two", "three"],
  }));
  let history: string[] = [];
  const seen = new Set<string>();
  for (let cycle = 0; cycle < 5; cycle++) {
    let game = newPartyGame("draw", pool, history);
    for (const p of names.slice(0, 2))
      game = partyCommand(game, p, { type: "ready", ready: true }, 1000);
    game = partyCommand(game, names[0]!, { type: "start" }, 1000);
    for (let round = 0; round < 2; round++) {
      for (const w of game.choices) {
        expect(seen.has(w.answer)).toBe(false);
        seen.add(w.answer);
      }
      expect(new Set(game.choices.map((w) => w.category)).size).toBe(3);
      game = tickPartyGame(game, game.deadline!);
      game = tickPartyGame(game, game.deadline!);
      game = tickPartyGame(game, game.deadline!);
    }
    history = game.recentAnswers!;
  }
  expect(seen.size).toBe(30);
});
test("small banks exhaust unseen questions before recycling and never reroll the rejected set", () => {
  const pool = Array.from({ length: 6 }, (_, i) => ({
    answer: `small${i}`,
    category: "one",
    clues: ["a", "b", "c"],
  }));
  let game = newPartyGame("draw", pool);
  for (const p of names.slice(0, 2))
    game = partyCommand(game, p, { type: "ready", ready: true }, 1000);
  game = partyCommand(game, names[0]!, { type: "start" }, 1000);
  const first = game.choices.map((w) => w.answer);
  game = partyCommand(game, names[0]!, { type: "reroll" }, 1000);
  expect(game.choices.some((w) => first.includes(w.answer))).toBe(false);
  const second = game.choices.map((w) => w.answer);
  game = partyCommand(game, names[0]!, { type: "reroll" }, 3000);
  expect(game.choices.some((w) => second.includes(w.answer))).toBe(false);
});

test("each game only uses compatible questions and keeps its pool private", () => {
  const words = [
    {
      answer: "draw only",
      category: "one",
      clues: ["a", "b", "c"],
      modes: ["draw"] as ("draw" | "quiz")[],
    },
    {
      answer: "quiz only",
      category: "two",
      clues: ["a", "b", "c"],
      modes: ["quiz"] as ("draw" | "quiz")[],
    },
    { answer: "legacy both", category: "three", clues: ["a", "b", "c"] },
  ];
  expect(newPartyGame("draw", words).wordPool!.map((w) => w.answer)).toEqual([
    "draw only",
    "legacy both",
  ]);
  expect(newPartyGame("quiz", words).wordPool!.map((w) => w.answer)).toEqual([
    "quiz only",
    "legacy both",
  ]);
});

test("guessing records only the one visible question, not hidden drawing alternatives", () => {
  const game = ready("quiz");
  expect(game.recentAnswers).toEqual([game.word!.answer]);
});
