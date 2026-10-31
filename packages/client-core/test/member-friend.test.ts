import { expect, test } from "bun:test";
import { memberFriendAction } from "../src/member-friend";

test("a member can request friendship, but cannot add themselves or an unknown target", () => {
  expect(memberFriendAction("me", "other", undefined)).toBe("request");
  expect(memberFriendAction("me", "me", undefined)).toBe("unavailable");
  expect(memberFriendAction(undefined, "other", undefined)).toBe("unavailable");
  expect(memberFriendAction("me", undefined, undefined)).toBe("unavailable");
});

test("incoming requests can be accepted while sent requests and existing friends cannot be resent", () => {
  expect(
    memberFriendAction("me", "other", { status: "pending", incoming: true }),
  ).toBe("accept");
  expect(
    memberFriendAction("me", "other", { status: "pending", incoming: false }),
  ).toBe("pending");
  expect(
    memberFriendAction("me", "other", { status: "accepted", incoming: true }),
  ).toBe("accepted");
  expect(
    memberFriendAction("me", "other", { status: "accepted", incoming: false }),
  ).toBe("accepted");
});
