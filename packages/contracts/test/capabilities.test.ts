import { expect, test } from "bun:test";
import * as c from "../src/index";

test("quality entitlement defaults closed and falls back without changing basic profiles", () => {
  expect(c.allowedShareQuality("game", undefined)).toBe("cinema");
  expect(c.allowedShareQuality("game", { highFrameRateEnabled: true })).toBe(
    "game",
  );
  expect(c.allowedShareQuality("saver", {})).toBe("saver");
  expect(c.allowedShareQuality("cinema", {})).toBe("cinema");
});
test("unified capability patches require changes and reject unknown fields or invalid quotas", () => {
  expect(c.adminCapabilitiesInput.safeParse({ reason: "测试" }).success).toBe(
    false,
  );
  expect(
    c.adminCapabilitiesInput.safeParse({
      reason: "测试",
      standardRoomMaxMembers: 25,
    }).success,
  ).toBe(true);
  for (const n of [9, 26, 10.5])
    expect(
      c.adminCapabilitiesInput.safeParse({
        reason: "测试",
        standardRoomMaxMembers: n,
      }).success,
    ).toBe(false);
  expect(
    c.adminCapabilitiesInput.safeParse({ reason: "测试", isSuperAdmin: true })
      .success,
  ).toBe(false);
});
test("room inputs and friend presence allow up to 25 while esports remains fixed at 20", () => {
  expect(
    c.roomInput.safeParse({ name: "扩容房", mode: "standard", maxMembers: 25 })
      .success,
  ).toBe(true);
  expect(c.roomSettingsInput.safeParse({ maxMembers: 26 }).success).toBe(false);
  expect(
    c.roomInput.safeParse({ name: "赛事", mode: "esports", maxMembers: 25 })
      .success,
  ).toBe(false);
  expect(
    c.friendRoomPresenceSchema.safeParse({ memberCount: 25, maxMembers: 25 })
      .success,
  ).toBe(true);
});
