import { expect, test } from "bun:test";
import {
  AnnouncementClient,
  announcementActive,
} from "../src/renderer/announcements";
import type { Announcement } from "@cinegather/contracts";
const at = Date.now();
const announcement: Announcement = {
  id: "01234567-1234-4234-8234-012345678901",
  title: "维护通知",
  body: "计划维护",
  kind: "maintenance",
  popup: true,
  state: "active",
  startsAt: new Date(at - 1000).toISOString(),
  expiresAt: new Date(at + 60000).toISOString(),
  publishedAt: new Date(at - 1000).toISOString(),
  createdAt: new Date(at - 2000).toISOString(),
  updatedAt: new Date(at - 1000).toISOString(),
};
test("server claim controls reminders, receipts isolate accounts, expired announcements cannot prompt", async () => {
  const reminded: string[] = [],
    snapshots: unknown[] = [];
  let claimed = false;
  const c = new AnnouncementClient(
    {
      load: async (signedIn) => ({
        serverTime: new Date(at).toISOString(),
        items: signedIn
          ? [{ ...announcement, received: claimed, read: false }]
          : [announcement],
      }),
      receive: async (ids) => {
        const remindIds = claimed ? [] : ids;
        claimed = true;
        return { remindIds };
      },
      read: async () => {},
      changed: (s) => snapshots.push(s),
      notices: (_items, fresh) => reminded.push(...fresh),
    },
    undefined,
    () => at,
  );
  await c.scope("A");
  await c.refresh();
  expect(reminded).toEqual([announcement.id]);
  expect(snapshots.length).toBeGreaterThan(0);
  expect(announcementActive(announcement, at + 61000)).toBe(false);
});
test("old-account work cannot create notices after logout, and valid public cache survives an offline refresh", async () => {
  let release!: (value: unknown) => void;
  const notices: string[] = [],
    snapshots: { items: Announcement[] }[] = [];
  const cache = {
    feed: { serverTime: new Date(at).toISOString(), items: [announcement] },
    offset: 0,
  };
  const c = new AnnouncementClient(
    {
      load: () =>
        new Promise((r) => {
          release = r;
        }),
      receive: async (ids) => ({ remindIds: ids }),
      read: async () => {},
      changed: (s) => snapshots.push(s),
      notices: (_items, fresh) => notices.push(...fresh),
    },
    { load: () => cache, save: () => {} },
    () => at,
  );
  const work = c.scope("A");
  void c.scope(undefined);
  release({
    serverTime: new Date(at).toISOString(),
    items: [{ ...announcement, received: false, read: false }],
  });
  await work;
  await Bun.sleep(0);
  expect(notices).toEqual([]);
  expect(snapshots.at(-1)!.items[0]?.id).toBe(announcement.id);
});

test("announcement notification expiry follows server time even when the device clock is offset", async () => {
  const { announcementNotification } = await import(
    "../src/renderer/announcements"
  );
  const n = announcementNotification(
    { ...announcement, body: "a".repeat(4000) },
    120000,
  );
  expect(n.expiresAt).toBe(Date.parse(announcement.expiresAt!) - 120000);
  expect(n.body?.length).toBe(300);
  expect(n.target).toBe("announcements");
});
