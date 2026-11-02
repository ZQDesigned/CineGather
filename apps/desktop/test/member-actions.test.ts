import { expect, test } from "bun:test";
import { memberManagementActions } from "../src/shared/member-actions";

test("ordinary room member moderation retains the existing capabilities", () => {
  expect(
    memberManagementActions({
      owner: true,
      self: false,
      mode: "standard",
      sharing: true,
    }),
  ).toEqual([
    "transfer",
    "mute",
    "stop-accompaniment",
    "block-mic",
    "block-share",
    "stop-share",
    "remove",
  ]);
});
test("esports player moderation permits seat and screen management without accompaniment", () => {
  expect(
    memberManagementActions({
      owner: true,
      self: false,
      mode: "esports",
      seat: { kind: "player", team: "b" },
      sharing: true,
    }),
  ).toEqual([
    "seat",
    "transfer",
    "mute",
    "block-mic",
    "block-share",
    "stop-share",
    "remove",
  ]);
});
test("director and audience moderation excludes screen sharing even if stale media claims a share", () => {
  for (const kind of ["director", "audience"] as const)
    expect(
      memberManagementActions({
        owner: true,
        self: false,
        mode: "esports",
        seat: { kind },
        sharing: true,
      }),
    ).toEqual(["seat", "transfer", "mute", "block-mic", "remove"]);
});
test("owners can change their own esports seat without self eviction or ownership transfer", () => {
  expect(
    memberManagementActions({
      owner: true,
      self: true,
      mode: "esports",
      seat: { kind: "audience" },
    }),
  ).toEqual(["seat"]);
  expect(
    memberManagementActions({ owner: true, self: true, mode: "standard" }),
  ).toEqual([]);
});
test("nonowners and unknown esports seats never receive management controls", () => {
  expect(
    memberManagementActions({
      owner: false,
      self: false,
      mode: "esports",
      seat: { kind: "audience" },
    }),
  ).toEqual([]);
  expect(
    memberManagementActions({ owner: true, self: false, mode: "esports" }),
  ).toEqual([]);
});
