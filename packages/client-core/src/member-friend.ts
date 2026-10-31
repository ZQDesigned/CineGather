export function memberFriendAction(
  selfId: string | undefined,
  targetId: string | undefined,
  friendship: { status: "pending" | "accepted"; incoming: boolean } | undefined,
) {
  if (!selfId || !targetId || selfId === targetId) return "unavailable";
  if (!friendship) return "request";
  if (friendship.status === "accepted") return "accepted";
  return friendship.incoming ? "accept" : "pending";
}
