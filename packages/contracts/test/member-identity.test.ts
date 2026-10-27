import { test, expect } from "bun:test";
import {
  memberIdentity,
  memberOwner,
  memberSession,
  participantOwner,
} from "../src/member-identity";
const user = "00000000-0000-4000-8000-000000000001",
  session = "00000000-0000-4000-8000-000000000002";
test("separate sessions of one account have distinct media identities but the same public owner", () => {
  const first = memberIdentity(user, session),
    second = memberIdentity(user, "00000000-0000-4000-8000-000000000003");
  expect(first).not.toBe(second);
  expect(memberOwner(first)).toBe(user);
  expect(memberSession(first)).toBe(session);
  expect(participantOwner(user)).toBe(user);
  expect(participantOwner(first)).toBe(user);
});
test("malformed session identities cannot alias a public user", () => {
  for (const id of [
    "cinegather/member/v1/" + user + "/bad",
    "https://x/" + user,
    memberIdentity(user, session) + "/extra",
    "not-a-user",
  ]) {
    expect(memberOwner(id)).toBeUndefined();
    expect(memberSession(id)).toBeUndefined();
    expect(participantOwner(id)).toBeUndefined();
  }
  expect(() => memberIdentity(user, "bad")).toThrow();
});
