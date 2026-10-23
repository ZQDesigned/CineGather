import { expect, test } from "bun:test";
import {
  hasAdminAccess,
  hasAdminPermission,
  adminRoleInput,
  registerInput,
  adminRoleAssignment,
} from "../src";
test("an audit-only administrator cannot operate accounts or rooms", () => {
  const access = { isSuperAdmin: false, permissions: ["audit.read"] as const };
  expect(hasAdminAccess(access)).toBe(true);
  expect(hasAdminPermission(access, "audit.read")).toBe(true);
  for (const p of [
    "users.read",
    "users.manage",
    "rooms.read",
    "rooms.manage",
  ] as const)
    expect(hasAdminPermission(access, p)).toBe(false);
  expect(hasAdminAccess(undefined)).toBe(false);
  expect(hasAdminAccess({ permissions: [] })).toBe(false);
});
test("superadmin access is independent from ordinary assigned roles", () => {
  expect(
    hasAdminPermission({ isSuperAdmin: true, permissions: [] }, "users.manage"),
  ).toBe(true);
  expect(
    hasAdminPermission(
      { isSuperAdmin: false, permissions: ["users.read"] },
      "users.manage",
    ),
  ).toBe(false);
});
test("only assignable permissions are accepted, with accompanying read access", () => {
  const base = { name: "房间管理", reason: "权限边界测试" };
  expect(
    adminRoleInput.safeParse({ ...base, permissions: ["superadmin"] }).success,
  ).toBe(false);
  expect(
    adminRoleInput.safeParse({ ...base, permissions: ["roles.manage"] })
      .success,
  ).toBe(false);
  expect(
    adminRoleInput.safeParse({ ...base, permissions: ["rooms.manage"] })
      .success,
  ).toBe(false);
  expect(
    adminRoleInput.safeParse({
      ...base,
      permissions: ["rooms.read", "rooms.manage"],
    }).success,
  ).toBe(true);
  expect(
    adminRoleInput.safeParse({
      ...base,
      permissions: ["audit.read", "audit.read"],
    }).success,
  ).toBe(false);
  expect(
    adminRoleAssignment.safeParse({
      roleIds: [],
      reason: "清空角色",
      isSuperAdmin: true,
    }).success,
  ).toBe(false);
  expect(
    registerInput.safeParse({
      username: "viewer",
      displayName: "观众",
      password: "Strong password 123!",
      isSuperAdmin: true,
    }).success,
  ).toBe(false);
});
