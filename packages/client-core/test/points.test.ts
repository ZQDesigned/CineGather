import { expect, test } from "bun:test";
import { nextPointsFeedback } from "../src/points";
import type { PointsSummary } from "@cinegather/contracts";
const snapshot = (id: string, sequence = 1, amount = 10) =>
  ({
    latest: { id, sequence, amount, outcome: amount ? "awarded" : "no_reward" },
  }) as PointsSummary;
test("award feedback suppresses initial history, repeated snapshots and out-of-order responses", () => {
  expect(nextPointsFeedback(undefined, snapshot("a"))).toBeUndefined();
  expect(nextPointsFeedback(snapshot("a"), snapshot("a"))).toBeUndefined();
  expect(
    nextPointsFeedback(snapshot("b", 2), snapshot("a", 1)),
  ).toBeUndefined();
  expect(
    nextPointsFeedback(snapshot("a"), snapshot("b", 2, 0)),
  ).toBeUndefined();
  expect(nextPointsFeedback(snapshot("a"), snapshot("b", 2))?.id).toBe("b");
  expect(
    nextPointsFeedback({ latest: null } as PointsSummary, snapshot("a"))
      ?.amount,
  ).toBe(10);
});
