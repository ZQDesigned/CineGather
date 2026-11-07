import type { PartyView } from "@cinegather/contracts";

export function activityMemberStatus(
  game: PartyView | undefined,
  userId: string,
) {
  if (!game) return undefined;
  const player = game.players.find((p) => p.id === userId);
  if (!player?.ready) return "旁观";
  if (game.phase === "lobby" || game.phase === "finished") return "已准备";
  if (game.drawerId === userId) return "画手";
  if (game.solvedIds.includes(userId)) return "已答对";
  return game.kind === "draw" ? "猜词中" : "答题中";
}
