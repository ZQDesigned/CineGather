import { expect, test } from "bun:test";
import {
  newPartyGame,
  partyCommand,
  tickPartyGame,
} from "../src/modules/party/party-game";
const people = ["a", "b", "c"].map((id) => ({ id, name: id }));
function playing(kind: "draw" | "quiz") {
  let g = newPartyGame(kind);
  for (const p of people)
    g = partyCommand(g, p, { type: "ready", ready: true }, 10000);
  g = partyCommand(g, people[0]!, { type: "start" }, 10000);
  if (kind === "draw")
    g = partyCommand(g, people[0]!, { type: "choose", index: 0 }, 10001);
  return g;
}
for (const kind of ["draw", "quiz"] as const) {
  test(`${kind}: an unsolved departing player cannot hold an otherwise completed round`, () => {
    let g = playing(kind);
    const guessers = people.filter(
      (p) => kind !== "draw" || p.id !== g.drawerId,
    );
    for (const p of guessers.filter((p) => p.id !== "c"))
      g = partyCommand(g, p, { type: "guess", answer: g.word!.answer }, 11000);
    const next = tickPartyGame(g, 12000, ["a", "b"]);
    expect(next.phase).toBe("results");
    expect(next.roundCompleted).toBe(true);
    expect(next.players.some((p) => p.id === "c")).toBe(false);
    expect(tickPartyGame(next, next.deadline!).round).toBeGreaterThan(g.round);
  });
  test(`${kind}: cancelling readiness re-evaluates remaining guesses immediately`, () => {
    let g = playing(kind);
    for (const p of people.filter(
      (p) => p.id !== "c" && (kind !== "draw" || p.id !== g.drawerId),
    ))
      g = partyCommand(g, p, { type: "guess", answer: g.word!.answer }, 11000);
    g = partyCommand(g, people[2]!, { type: "ready", ready: false }, 12000);
    expect(g.phase).toBe("results");
    expect(g.roundCompleted).toBe(true);
  });
  test(`${kind}: fewer than two remaining participants ends even a paused game`, () => {
    let g = playing(kind);
    g = partyCommand(g, people[0]!, { type: "pause" }, 11000);
    g = tickPartyGame(g, 12000, ["b"]);
    expect(g.phase).toBe("finished");
    expect(g.deadline).toBeUndefined();
    expect(g.pausedPhase).toBeUndefined();
    expect(g.roundCompleted).toBe(false);
  });
}
test("a departing drawer cancels the turn, skips their later slot and never earns participation", () => {
  let g = playing("draw");
  g.drewThisRound = true;
  g = partyCommand(g, people[0]!, { type: "pause" }, 11000);
  g = tickPartyGame(g, 12000, ["b", "c"]);
  expect(g.phase).toBe("results");
  expect(g.roundCompleted).toBe(false);
  expect(g.pausedPhase).toBeUndefined();
  g = tickPartyGame(g, g.deadline!);
  expect(g.drawerId).toBe("b");
  expect(g.phase).toBe("choosing");
});
test("a coherent paused game stays paused; completing it updates the paused phase without resuming", () => {
  let g = playing("draw");
  g = partyCommand(g, people[0]!, { type: "pause" }, 11000);
  expect(tickPartyGame(g, 12000, ["a", "b"]).phase).toBe("paused");
  g = partyCommand(g, people[0]!, { type: "resume" }, 13000);
  g = partyCommand(
    g,
    people[1]!,
    { type: "guess", answer: g.word!.answer },
    14000,
  );
  g = partyCommand(g, people[0]!, { type: "pause" }, 15000);
  g = tickPartyGame(g, 16000, ["a", "b"]);
  expect(g.phase).toBe("paused");
  expect(g.pausedPhase).toBe("results");
  expect(g.roundCompleted).toBe(true);
  expect(partyCommand(g, people[0]!, { type: "resume" }, 17000).phase).toBe(
    "results",
  );
});
