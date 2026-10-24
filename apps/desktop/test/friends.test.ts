import { expect, test } from "bun:test";
import {
  FriendRequests,
  hasIncomingRequests,
  type Friend,
} from "../src/renderer/friends";

const request: Friend = {
  userId: "friend",
  displayName: "朋友",
  status: "pending",
  incoming: true,
};
test("only incoming pending requests need a sidebar dot", () => {
  expect(hasIncomingRequests([])).toBe(false);
  expect(hasIncomingRequests([{ ...request, incoming: false }])).toBe(false);
  expect(hasIncomingRequests([{ ...request, status: "accepted" }])).toBe(false);
  expect(hasIncomingRequests([request])).toBe(true);
});
test("old requests cannot restore a handled request or leak into another account", async () => {
  let identity: string | undefined = "alice";
  let items: Friend[] = [];
  const pending: ((items: Friend[]) => void)[] = [];
  const friends = new FriendRequests(
    () => identity,
    () => new Promise((resolve) => pending.push(resolve)),
    (next) => {
      items = next;
    },
  );
  const old = friends.refresh();
  const handled = friends.refresh();
  pending[1]!([]);
  await handled;
  pending[0]!([request]);
  await old;
  expect(items).toEqual([]);
  const beforeLogout = friends.refresh();
  friends.clear();
  identity = "bob";
  pending[2]!([request]);
  await beforeLogout;
  expect(items).toEqual([]);
});
