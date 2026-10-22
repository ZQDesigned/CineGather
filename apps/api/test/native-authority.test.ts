import { expect, test } from "bun:test";
import {
  nativeIdentity,
  nativeOwner,
  requireNativeLease,
} from "../src/native-authority";
const user = "b22aae66-1d3f-43f7-b958-f551a8623609";
const leaseId = "c22aae66-1d3f-43f7-b958-f551a8623609";
const lease = {
  holderUserId: user,
  leaseId,
  revision: 4,
  expiresAt: new Date(2000),
};
test("native credentials require current holder, revision, live human connection and unexpired authority", () => {
  expect(() =>
    requireNativeLease(lease, user, { leaseId, revision: 4 }, true, 1000),
  ).not.toThrow();
  for (const [id, rev, connected, now] of [
    [user, 3, true, 1000],
    ["other", 4, true, 1000],
    [user, 4, false, 1000],
    [user, 4, true, 2000],
  ] as const)
    expect(() =>
      requireNativeLease(lease, id, { leaseId, revision: rev }, connected, now),
    ).toThrow();
  expect(() =>
    requireNativeLease(null, user, { leaseId, revision: 4 }, true, 1000),
  ).toThrow();
});
test("only exact auxiliary identities map to a human; each lease has a different identity", () => {
  expect(nativeOwner(nativeIdentity(user, leaseId))).toBe(user);
  for (const identity of [
    user,
    "cg-native:" + user,
    nativeIdentity(user, leaseId) + ":evil",
  ])
    expect(nativeOwner(identity)).toBeUndefined();
});
