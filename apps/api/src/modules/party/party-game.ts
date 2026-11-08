import { randomInt } from "node:crypto";
import { partyAnswerKey } from "@cinegather/contracts";
import type {
  PartyAction,
  PartyPlayer,
  PartyView,
} from "@cinegather/contracts";
import { partyWords, type PartyWord } from "./party-words";

export interface PartyGame {
  kind: "draw" | "quiz";
  wordPool?: PartyWord[];
  categorySelection?: { categoryIds: string[] | null; version: number };
  phase: PartyView["phase"];
  round: number;
  totalRounds: number;
  deadline?: number;
  pausedPhase?: "choosing" | "playing" | "results";
  remaining?: number;
  players: PartyPlayer[];
  order: string[];
  drawerId?: string;
  word?: PartyWord;
  choices: PartyWord[];
  choicesRevision?: number;
  rerollsUsed?: number;
  rerollAvailableAt?: number;
  choiceHistory?: string[];
  used: string[];
  recentAnswers?: string[];
  solvedIds: string[];
  lastGuesses: Record<string, number>;
}
export function newPartyGame(
  kind: "draw" | "quiz",
  wordPool: PartyWord[] = partyWords,
  recentAnswers: string[] = [],
): PartyGame {
  return {
    kind,
    wordPool: structuredClone(
      wordPool.filter((w) => !w.modes || w.modes.includes(kind)),
    ),
    phase: "lobby",
    round: 0,
    totalRounds: 0,
    players: [],
    order: [],
    choices: [],
    used: [],
    recentAnswers: [...recentAnswers],
    solvedIds: [],
    lastGuesses: {},
  };
}
function replacementPool(game: PartyGame) {
  const rejected = new Set(game.choices.map((w) => partyAnswerKey(w.answer)));
  return (game.wordPool ?? partyWords).filter(
    (w) => !rejected.has(partyAnswerKey(w.answer)),
  );
}
function candidates(game: PartyGame, replacements?: PartyWord[]) {
  const pool = game.wordPool ?? partyWords;
  const active = new Set(pool.map((w) => partyAnswerKey(w.answer)));
  const history = [
    ...new Set(
      (
        game.recentAnswers ?? [
          ...game.used,
          ...(game.choiceHistory ?? game.choices.map((w) => w.answer)),
        ]
      ).map(partyAnswerKey),
    ),
  ].filter((key) => active.has(key));
  const recency = new Map(history.map((key, index) => [key, index]));
  let available = [
    ...new Map(
      (replacements ?? pool).map((w) => [partyAnswerKey(w.answer), w]),
    ).values(),
  ];
  const count = game.kind === "draw" ? 3 : 1;
  if (available.length < count) throw Error("暂无更多题目可更换");
  const selected: PartyWord[] = [];
  while (selected.length < count) {
    const unseen = available.filter(
      (w) => !recency.has(partyAnswerKey(w.answer)),
    );
    // Consume unseen words first, then recycle the oldest available word.
    let eligible = unseen;
    if (!eligible.length) {
      const oldest = Math.min(
        ...available.map((w) => recency.get(partyAnswerKey(w.answer))!),
      );
      eligible = available.filter(
        (w) => recency.get(partyAnswerKey(w.answer)) === oldest,
      );
    }
    const categories = new Set(selected.map((w) => w.category));
    const varied = eligible.filter((w) => !categories.has(w.category));
    if (varied.length) eligible = varied;
    // Pick category first, so larger categories do not drown out smaller ones.
    const groups = [...new Set(eligible.map((w) => w.category))];
    const category = groups[randomInt(groups.length)];
    const group = eligible.filter((w) => w.category === category);
    const word = group[randomInt(group.length)]!;
    selected.push(word);
    const key = partyAnswerKey(word.answer);
    available = available.filter((w) => partyAnswerKey(w.answer) !== key);
    const previous = history.indexOf(key);
    if (previous >= 0) history.splice(previous, 1);
    history.push(key);
  }
  game.recentAnswers = history.slice(-5000);
  return selected;
}
function nextRound(game: PartyGame, now: number) {
  if (
    game.round >= game.totalRounds ||
    game.players.filter((p) => p.ready).length < 2
  ) {
    game.phase = "finished";
    game.deadline = undefined;
    game.choices = [];
    return;
  }
  game.round++;
  game.solvedIds = [];
  game.lastGuesses = {};
  game.choices = candidates(game);
  game.choicesRevision = (game.choicesRevision ?? 0) + 1;
  game.rerollsUsed = 0;
  game.rerollAvailableAt = undefined;
  game.choiceHistory = game.choices.map((w) => w.answer);
  game.word = undefined;
  if (game.kind === "draw") {
    game.drawerId = game.order[(game.round - 1) % game.order.length];
    if (!game.players.some((p) => p.id === game.drawerId && p.ready)) {
      nextRound(game, now);
      return;
    }
    game.phase = "choosing";
    game.deadline = now + 15_000;
  } else {
    choose(game, 0, now);
  }
}
function choose(game: PartyGame, index: number, now: number) {
  game.word = game.choices[index]!;
  game.used.push(game.word.answer);
  game.choices = [];
  game.phase = "playing";
  game.deadline = now + (game.kind === "draw" ? 90_000 : 45_000);
}
function results(game: PartyGame, now: number) {
  game.phase = "results";
  game.deadline = now + 5000;
  game.choices = [];
}
export function tickPartyGame(input: PartyGame, now: number): PartyGame {
  const game = structuredClone(input);
  if (!game.deadline || game.deadline > now) return game;
  if (game.phase === "choosing") choose(game, 0, now);
  else if (game.phase === "playing") results(game, now);
  else if (game.phase === "results") nextRound(game, now);
  return game;
}
export function partyCommand(
  input: PartyGame,
  actor: { id: string; name: string },
  action: PartyAction,
  now: number,
): PartyGame {
  if (action.type === "categories") throw Error("分类选择需由房间校验");
  const game = tickPartyGame(input, now);
  let player = game.players.find((p) => p.id === actor.id);
  if (action.type === "ready") {
    if (player?.ready === action.ready) return game;
    if (!player) {
      if (!action.ready) return game;
      if (game.players.length >= 25) throw Error("参与人数已满");
      player = {
        ...actor,
        ready: action.ready,
        eligibleRound: game.round + 1,
      };
      game.players.push(player);
    }
    player.ready = action.ready;
    if (action.ready && !["lobby", "finished"].includes(game.phase))
      player.eligibleRound = game.round + 1;
    if (
      !action.ready &&
      game.drawerId === actor.id &&
      ["choosing", "playing"].includes(game.phase)
    )
      results(game, now);
    return game;
  }
  if (action.type === "start") {
    if (!["lobby", "finished"].includes(game.phase)) throw Error("游戏已开始");
    const ready = game.players.filter((p) => p.ready);
    if (ready.length < 2) throw Error("至少需要两位成员准备");
    game.order = ready.map((p) => p.id);
    game.totalRounds = game.kind === "draw" ? ready.length : 6;
    game.players.forEach((p) => {
      p.eligibleRound = 1;
    });
    game.round = 0;
    nextRound(game, now);
    return game;
  }
  if (action.type === "pause") {
    if (!["choosing", "playing", "results"].includes(game.phase))
      throw Error("当前不能暂停");
    game.pausedPhase = game.phase as PartyGame["pausedPhase"];
    game.remaining = Math.max(0, (game.deadline ?? now) - now);
    game.deadline = undefined;
    game.phase = "paused";
    return game;
  }
  if (action.type === "resume") {
    if (game.phase !== "paused" || !game.pausedPhase) throw Error("游戏未暂停");
    game.phase = game.pausedPhase;
    game.deadline = now + (game.remaining ?? 0);
    delete game.pausedPhase;
    delete game.remaining;
    return game;
  }
  if (action.type === "reroll") {
    if (
      game.kind !== "draw" ||
      game.phase !== "choosing" ||
      actor.id !== game.drawerId
    )
      throw Error("仅当前画手可以在选词时换一组");
    if (
      action.choicesRevision !== undefined &&
      action.choicesRevision !== (game.choicesRevision ?? 0)
    )
      throw Error("题目已更新，请重新选择");
    if ((game.rerollsUsed ?? 0) >= 3) throw Error("本轮换词次数已用完");
    if (now < (game.rerollAvailableAt ?? 0))
      throw Error("换词需间隔 2 秒，请稍后重试");
    const pool = replacementPool(game);
    if (pool.length < 3) throw Error("暂无更多题目可更换");
    game.choiceHistory = [
      ...new Set([
        ...(game.choiceHistory ?? []),
        ...game.choices.map((w) => w.answer),
      ]),
    ];
    game.choices = candidates(game, pool);
    game.choiceHistory.push(...game.choices.map((w) => w.answer));
    game.choicesRevision = (game.choicesRevision ?? 0) + 1;
    game.rerollsUsed = (game.rerollsUsed ?? 0) + 1;
    game.rerollAvailableAt = now + 2000;
    return game;
  }
  if (action.type === "choose") {
    if (game.phase !== "choosing" || actor.id !== game.drawerId)
      throw Error("当前不能选词");
    if (
      action.choicesRevision !== undefined &&
      action.choicesRevision !== (game.choicesRevision ?? 0)
    )
      throw Error("题目已更新，请重新选择");
    choose(game, action.index, now);
    return game;
  }
  if (
    game.phase !== "playing" ||
    !player?.ready ||
    player.eligibleRound > game.round ||
    (game.kind === "draw" && actor.id === game.drawerId)
  )
    throw Error("当前不能答题");
  if (game.solvedIds.includes(actor.id)) throw Error("你已经猜对了");
  if (now - (game.lastGuesses[actor.id] ?? -Infinity) < 800)
    throw Error("答题太快，请稍后再试");
  game.lastGuesses[actor.id] = now;
  const normalize = (s: string) =>
    s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (normalize(action.answer) === normalize(game.word!.answer)) {
    game.solvedIds.push(actor.id);
    const guessers = game.players.filter(
      (p) =>
        p.ready &&
        p.eligibleRound <= game.round &&
        (game.kind !== "draw" || p.id !== game.drawerId),
    );
    if (guessers.every((p) => game.solvedIds.includes(p.id)))
      results(game, now);
  }
  return game;
}
export function partyView(
  game: PartyGame,
  userId: string,
  now: number,
): PartyView {
  const reveal =
    ["results", "finished"].includes(game.phase) ||
    (game.kind === "draw" && game.drawerId === userId);
  const elapsed =
    45_000 -
    Math.max(0, (game.deadline ?? now + (game.remaining ?? 45_000)) - now);
  return {
    kind: game.kind,
    categorySelection: game.categorySelection ?? {
      categoryIds: null,
      version: 0,
    },
    phase: game.phase,
    round: Math.min(game.round, game.totalRounds),
    totalRounds: game.totalRounds,
    deadline: game.deadline,
    serverTime: now,
    drawerId: game.drawerId,
    players: game.players.map(({ id, name, ready, eligibleRound }) => ({
      id,
      name,
      ready,
      eligibleRound,
    })),
    solvedIds: game.solvedIds,
    ...(game.phase === "choosing" && game.drawerId === userId
      ? {
          choices: game.choices.map((w) => w.answer),
          ...(game.choices.some((w) => w.author)
            ? { choiceAuthors: game.choices.map((w) => w.author ?? null) }
            : {}),
          choicesRevision: game.choicesRevision ?? 0,
          rerollsRemaining: Math.max(0, 3 - (game.rerollsUsed ?? 0)),
          rerollAvailableAt: game.rerollAvailableAt,
          canReroll: replacementPool(game).length >= 3,
        }
      : {}),
    ...(reveal && game.word
      ? {
          answer: game.word.answer,
          ...(game.word.author ? { answerAuthor: game.word.author } : {}),
        }
      : {}),
    ...(game.word
      ? {
          category: game.word.category,
          wordLength: [...game.word.answer].length,
        }
      : {}),
    ...(game.kind === "quiz" && game.word
      ? {
          clue: game.word.clues[
            Math.min(2, Math.max(0, Math.floor(elapsed / 15_000)))
          ],
        }
      : {}),
  };
}
