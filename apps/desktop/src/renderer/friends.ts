import type { RoomInvitation } from "@cinegather/contracts";

export interface Friend {
  userId: string;
  displayName: string;
  status: "pending" | "accepted";
  incoming: boolean;
  online?: boolean;
}

export const hasIncomingRequests = (friends: Friend[]) =>
  friends.some((friend) => friend.incoming && friend.status === "pending");

export class FriendRequests {
  private revision = 0;
  constructor(
    private readonly identity: () => string | undefined,
    private readonly load: () => Promise<{
      items: Friend[];
      roomInvitations?: RoomInvitation[];
    }>,
    private readonly changed: (
      friends: Friend[],
      invitations: RoomInvitation[],
    ) => void,
  ) {}
  clear() {
    ++this.revision;
    this.changed([], []);
  }
  async refresh() {
    const identity = this.identity();
    if (!identity) return;
    const revision = ++this.revision;
    try {
      const friends = await this.load();
      if (identity === this.identity() && revision === this.revision)
        this.changed(friends.items, friends.roomInvitations ?? []);
    } catch (error) {
      if (identity === this.identity() && revision === this.revision)
        throw error;
    }
  }
}
