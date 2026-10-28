import type {
  FriendRoomPresence,
  RoomInvitation,
  RoomJoinRequest,
  ClientNotification,
  NotificationRecord,
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

export function friendRequestNotification(
  friend: Friend,
  previous?: NotificationRecord,
  epoch: () => string = () => crypto.randomUUID(),
): ClientNotification | undefined {
  if (!friend.incoming || friend.status !== "pending") return;
  const id = "friend:" + friend.userId;
  const current = previous?.id === id ? previous : undefined;
  return {
    eventId: current
      ? current.active
        ? current.eventId
        : `${id}:${epoch()}`
      : id,
    groupId: id,
    category: "friends",
    title: `${friend.displayName} 申请添加好友`,
    target: "friends",
    entityId: friend.userId,
  };
}

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
      reset?: boolean,
    ) => void,
  ) {}
  clear() {
    ++this.revision;
    this.changed([], [], [], true);
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
