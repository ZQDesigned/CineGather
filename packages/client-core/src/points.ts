import type { PointsSummary, PointsEntry } from "@cinegather/contracts";
export function nextPointsFeedback(
  previous: PointsSummary | undefined,
  next: PointsSummary,
): PointsEntry | undefined {
  const entry = next.latest;
  if (
    !previous ||
    !entry ||
    entry.id === previous.latest?.id ||
    entry.sequence <= (previous.latest?.sequence ?? 0) ||
    entry.outcome === "no_reward" ||
    entry.outcome === "disabled"
  )
    return;
  return entry;
}
export function pointsReason(entry: Pick<PointsEntry, "reward" | "attempt">) {
  return entry.reward === "painter"
    ? "画手有效参与"
    : entry.reward === "correct"
      ? `第 ${entry.attempt} 次提交即猜中`
      : "游戏结算";
}
export function pointsGameName(game: string) {
  return (
    (
      { "party.draw": "你画我猜", "party.quiz": "猜词抢答" } as Record<
        string,
        string
      >
    )[game] ?? game
  );
}
