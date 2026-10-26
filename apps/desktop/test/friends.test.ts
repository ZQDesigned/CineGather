import { expect, test } from "bun:test";
import type { RoomInvitation } from "@cinegather/contracts";
import {
  FriendRequests,
  friendPresenceLabel,
  hasIncomingRequests,
  type Friend,
} from "../src/renderer/friends";

const request: Friend = {
  userId: "friend",
  displayName: "朋友",
  status: "pending",
  incoming: true,
};
const roomInvitation: RoomInvitation = {
  id: "00000000-0000-4000-8000-000000000001",
  roomId: "00000000-0000-4000-8000-000000000002",
  senderId: "00000000-0000-4000-8000-000000000003",
  senderName: "朋友",
  roomName: "受邀房间",
  token: "a".repeat(64),
  expiresAt: "2030-01-01T00:00:00Z",
};
test("friend room status follows visibility and handles older servers", () => {
  const friend = { ...request, status: "accepted" as const, online: true };
  expect(friendPresenceLabel(friend)).toBe("在线");
  expect(friendPresenceLabel({ ...friend, room: null })).toBe("在线");
  const room = { memberCount: 2, maxMembers: 5 };
  expect(friendPresenceLabel({ ...friend, room })).toBe("房间中（2/5）");
  expect(friendPresenceLabel({ ...friend, room, online: false })).toBe("离线");
  expect(friendPresenceLabel({ ...request, room, online: true })).toBe("离线");
});
test("only incoming pending requests need a sidebar dot", () => {
  expect(hasIncomingRequests([])).toBe(false);
  expect(hasIncomingRequests([{ ...request, incoming: false }])).toBe(false);
  expect(hasIncomingRequests([{ ...request, status: "accepted" }])).toBe(false);
  expect(hasIncomingRequests([request])).toBe(true);
});
test("old requests cannot restore a handled request or leak into another account", async () => {
  let identity: string | undefined = "alice";
  let items: Friend[] = [];
  let invitations: RoomInvitation[] = [];
  const pending: ((items: Friend[]) => void)[] = [];
  const friends = new FriendRequests(
    () => identity,
    async () => {
      const items = await new Promise<Friend[]>((resolve) =>
        pending.push(resolve),
      );
      return { items, roomInvitations: items.length ? [roomInvitation] : [] };
    },
    (next, roomInvitations) => {
      items = next;
      invitations = roomInvitations;
    },
  );
  const old = friends.refresh();
  const handled = friends.refresh();
  pending[1]!([]);
  await handled;
  pending[0]!([request]);
  await old;
  expect(items).toEqual([]);
  expect(invitations).toEqual([]);
  const beforeLogout = friends.refresh();
  friends.clear();
  identity = "bob";
  pending[2]!([request]);
  await beforeLogout;
  expect(items).toEqual([]);
  expect(invitations).toEqual([]);
  const fresh = friends.refresh();
  pending[3]!([request]);
  await fresh;
  expect(invitations).toEqual([roomInvitation]);
  friends.clear();
  expect(invitations).toEqual([]);
});
