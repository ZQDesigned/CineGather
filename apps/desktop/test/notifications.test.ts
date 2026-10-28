import { test, expect } from "bun:test";
import {
  NotificationInbox,
  notificationDelivery,
} from "../src/shared/notifications";
import { defaultNotificationPreferences } from "@cinegather/contracts";

function fixture() {
  let time = 1_800_000_000_000;
  const storage = new Map<string, unknown>();
  const inbox = new NotificationInbox(
    {
      load: (key) => storage.get(key),
      save: (key, value) => storage.set(key, structuredClone(value)),
    },
    () => {},
    () => time,
  );
  inbox.scope("server-a:user-a");
  return { inbox, storage, advance: (ms: number) => (time += ms) };
}
const chat = (id: string) => ({
  eventId: id,
  groupId: "chat:room-a",
  category: "chat" as const,
  title: "朋友发来消息",
  body: id,
  target: "chat" as const,
  roomId: "room-a",
});

test("notification replays do not alert again; chat bursts merge and can become unread after reading", () => {
  const { inbox } = fixture();
  expect(inbox.publish(chat("one"))).toBe(true);
  expect(inbox.publish(chat("one"))).toBe(false);
  expect(inbox.publish(chat("two"))).toBe(true);
  expect(inbox.snapshot()).toHaveLength(1);
  expect(inbox.snapshot()[0]).toMatchObject({
    count: 2,
    body: "two",
    read: false,
  });
  inbox.read("chat:room-a");
  expect(inbox.snapshot()[0]!.read).toBe(true);
  inbox.publish(chat("three"));
  expect(inbox.snapshot()[0]).toMatchObject({ count: 1, read: false });
});

test("history is scoped, survives restart and clearing does not replay already delivered events", () => {
  const { inbox } = fixture();
  inbox.publish(chat("one"));
  inbox.clear();
  expect(inbox.snapshot()).toEqual([]);
  expect(inbox.publish(chat("one"))).toBe(false);
  inbox.scope("server-b:user-a");
  expect(inbox.snapshot()).toEqual([]);
  expect(inbox.publish(chat("one"))).toBe(true);
  inbox.scope("server-a:user-a");
  expect(inbox.snapshot()).toEqual([]);
  expect(inbox.publish(chat("one"))).toBe(false);
  inbox.scope(undefined);
  expect(inbox.publish(chat("logged-out"))).toBe(false);
});

test("resolved and expired requests remain history without an active action", () => {
  const { inbox, advance } = fixture();
  inbox.publish({
    ...chat("request"),
    groupId: undefined,
    category: "room-request",
    target: "room-requests",
    expiresAt: 1_800_000_000_500,
  });
  expect(inbox.snapshot()[0]!.active).toBe(true);
  advance(501);
  expect(inbox.snapshot()[0]!.active).toBe(false);
  inbox.publish({ ...chat("request-two"), groupId: undefined });
  inbox.resolve("request-two");
  expect(
    inbox.snapshot().find((item) => item.id === "request-two")!.active,
  ).toBe(false);
  expect(inbox.publish({ ...chat("request-two"), groupId: undefined })).toBe(
    false,
  );
});

test("history and dedupe storage are bounded, old entries and malformed caches are discarded", () => {
  const { inbox, storage, advance } = fixture();
  for (let n = 0; n < 550; n++)
    inbox.publish({ ...chat(String(n)), groupId: undefined });
  expect(inbox.snapshot()).toHaveLength(100);
  const cache = storage.get("server-a:user-a") as { seen: unknown[] };
  expect(cache.seen).toHaveLength(500);
  advance(7 * 86400_000 + 1);
  expect(inbox.snapshot()).toEqual([]);
  storage.set("broken", { items: [{ title: "untrusted" }], seen: "wrong" });
  inbox.scope("broken");
  expect(inbox.snapshot()).toEqual([]);
});

test("delivery follows category and DND settings, shares hide bodies, and sound has its own cooldown", () => {
  const prefs = defaultNotificationPreferences;
  const options = {
    background: true,
    sharing: false,
    now: 10_000,
    lastSound: 0,
  };
  expect(notificationDelivery(prefs, chat("one"), options)).toMatchObject({
    desktop: true,
    sound: true,
    body: "one",
  });
  expect(
    notificationDelivery(prefs, chat("one"), { ...options, background: false }),
  ).toMatchObject({ desktop: false, sound: true });
  expect(
    notificationDelivery(prefs, chat("one"), { ...options, lastSound: 9_000 })
      .sound,
  ).toBe(false);
  expect(
    notificationDelivery(prefs, chat("one"), { ...options, sharing: true }),
  ).toMatchObject({ title: "映聚", body: "收到一条新消息" });
  expect(
    notificationDelivery(
      { ...prefs, doNotDisturb: true },
      chat("one"),
      options,
    ),
  ).toMatchObject({ desktop: false, sound: false });
  expect(
    notificationDelivery({ ...prefs, chat: false }, chat("one"), options),
  ).toMatchObject({ desktop: false, sound: false });
});
