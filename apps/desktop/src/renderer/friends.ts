import type {
  FriendRoomPresence,
  RoomInvitation,
  RoomJoinRequest,
} from "@cinegather/contracts";

export interface Friend {
  userId: string;
  displayName: string;
  status: "pending" | "accepted";
  incoming: boolean;
  online?: boolean;
  room?: FriendRoomPresence | null;
}

export const friendPresenceLabel = (friend: Friend) => {
  if (!friend.online || friend.status !== "accepted") return "离线";
  return friend.room
    ? `房间中（${friend.room.memberCount}/${friend.room.maxMembers}）`
    : "在线";
};

export const hasIncomingRequests = (friends: Friend[]) =>
  friends.some((friend) => friend.incoming && friend.status === "pending");

export class FriendRequests {
  private revision = 0;
  constructor(
    private readonly identity: () => string | undefined,
    private readonly load: () => Promise<{
      items: Friend[];
      roomInvitations?: RoomInvitation[];
      roomJoinRequests?: RoomJoinRequest[];
    }>,
    private readonly changed: (
      friends: Friend[],
      invitations: RoomInvitation[],
      requests: RoomJoinRequest[],
    ) => void,
  ) {}
  clear() {
    ++this.revision;
    this.changed([], [], []);
  }
  async refresh() {
    const identity = this.identity();
    if (!identity) return;
    const revision = ++this.revision;
    try {
      const friends = await this.load();
      if (identity === this.identity() && revision === this.revision)
        this.changed(
          friends.items,
          friends.roomInvitations ?? [],
          friends.roomJoinRequests ?? [],
        );
    } catch (error) {
      if (identity === this.identity() && revision === this.revision)
        throw error;
    }
  }
}
