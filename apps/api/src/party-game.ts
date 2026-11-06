import { randomInt } from "node:crypto";
import type {
  PartyAction,
  PartyPlayer,
  PartyView,
} from "@cinegather/contracts";
import { partyWords, type PartyWord } from "./party-words";

export interface PartyGame {
  kind: "draw" | "quiz";
  wordPool?: PartyWord[];
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
  used: string[];
  solvedIds: string[];
  lastGuesses: Record<string, number>;
}
export function newPartyGame(
  kind: "draw" | "quiz",
  wordPool: PartyWord[] = partyWords,
): PartyGame {
  return {
    kind,
    wordPool: structuredClone(wordPool),
    phase: "lobby",
    round: 0,
    totalRounds: 0,
    players: [],
    order: [],
    choices: [],
    used: [],
    solvedIds: [],
    lastGuesses: {},
  };
}
function candidates(game: PartyGame) {
  const pool = game.wordPool ?? partyWords;
  let available = pool.filter((w) => !game.used.includes(w.answer));
  if (available.length < 3) available = [...pool];
  const selected: PartyWord[] = [];
  while (selected.length < 3)
    selected.push(available.splice(randomInt(available.length), 1)[0]!);
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
  game.deadline = now + (game.kind === "draw" ? 60_000 : 45_000);
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
  if (action.type === "choose") {
    if (game.phase !== "choosing" || actor.id !== game.drawerId)
      throw Error("当前不能选词");
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
      ? { choices: game.choices.map((w) => w.answer) }
      : {}),
    ...(reveal && game.word ? { answer: game.word.answer } : {}),
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
