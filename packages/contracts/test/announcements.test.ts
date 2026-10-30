import { expect, test } from "bun:test";
import {
  announcementInput,
  adminPermissionSchema,
  adminRoleInput,
  clientNotificationSchema,
} from "../src";
test("announcement draft input bounds plain text and permissions require paired read access", () => {
  expect(
    announcementInput.parse({
      title: "  维护通知 ",
      body: "今晚维护",
      kind: "maintenance",
    }),
  ).toMatchObject({
    title: "维护通知",
    popup: true,
    startsAt: null,
    expiresAt: null,
  });
  expect(
    announcementInput.safeParse({ title: "x", body: "x".repeat(4001) }).success,
  ).toBe(false);
  expect(adminPermissionSchema.safeParse("announcements.manage").success).toBe(
    true,
  );
  expect(
    adminRoleInput.safeParse({
      name: "公告管理员",
      permissions: ["announcements.manage"],
      reason: "安排维护",
    }).success,
  ).toBe(false);
  expect(
    adminRoleInput.safeParse({
      name: "公告管理员",
      permissions: ["announcements.read", "announcements.manage"],
      reason: "安排维护",
    }).success,
  ).toBe(true);
  expect(
    clientNotificationSchema.safeParse({
      eventId: "announcement:x",
      category: "system",
      target: "announcements",
      title: "维护通知",
    }).success,
  ).toBe(true);
});
