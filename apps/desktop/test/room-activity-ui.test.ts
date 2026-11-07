import { expect, test } from "bun:test";
import type { PartyView } from "@cinegather/contracts";
import { activityMemberStatus } from "../src/renderer/features/activities/room-activity-ui";

const game: PartyView = {
  kind: "draw",
  phase: "playing",
  round: 1,
  totalRounds: 4,
  serverTime: 1000,
  drawerId: "a",
  solvedIds: ["b"],
  players: [
    { id: "a", name: "甲", ready: true, eligibleRound: 1 },
    { id: "b", name: "乙", ready: true, eligibleRound: 1 },
    { id: "c", name: "丙", ready: true, eligibleRound: 1 },
  ],
};
test("game member status distinguishes drawer, correct answers, guessers and spectators without exposing the word", () => {
  expect(activityMemberStatus(game, "a")).toBe("画手");
  expect(activityMemberStatus(game, "b")).toBe("已答对");
  expect(activityMemberStatus(game, "c")).toBe("猜词中");
  expect(activityMemberStatus(game, "outside")).toBe("旁观");
});
test("lobby and finished games show readiness rather than stale drawing or answer status", () => {
  for (const phase of ["lobby", "finished"] as const) {
    expect(activityMemberStatus({ ...game, phase }, "a")).toBe("已准备");
    expect(activityMemberStatus({ ...game, phase }, "b")).toBe("已准备");
  }
  expect(activityMemberStatus(undefined, "a")).toBeUndefined();
  expect(
    activityMemberStatus({ ...game, kind: "quiz", drawerId: undefined }, "c"),
  ).toBe("答题中");
});
