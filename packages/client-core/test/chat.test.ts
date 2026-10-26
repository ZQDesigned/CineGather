import { expect, test } from "bun:test";
import { RoomChat } from "../src/chat";
const m = (id: string, userId = "other") => ({
  id,
  userId,
  displayName: userId,
  body: id,
  createdAt: `2026-10-26T00:00:${id.padStart(2, "0")}.000Z`,
});
test("initial history is read, live messages deduplicate and own messages never increase unread", async () => {
  const notifications: string[] = [];
  const chat = new RoomChat(
    async () => ({ items: [m("01")], nextCursor: null }),
    () => {},
    (msg) => notifications.push(msg.id),
  );
  await chat.enter("room", "self");
  expect(chat.snapshot().unread).toBe(0);
  chat.receive("room", m("02"));
  chat.receive("room", m("02"));
  chat.receive("room", m("03", "self"));
  expect(chat.snapshot().items).toHaveLength(3);
  expect(chat.snapshot().unread).toBe(1);
  expect(notifications).toEqual(["02"]);
  chat.setView(true, true);
  expect(chat.snapshot().unread).toBe(0);
  chat.receive("room", m("04"));
  expect(chat.snapshot().unread).toBe(0);
  chat.setView(true, false);
  chat.receive("room", m("05"));
  expect(chat.snapshot().unread).toBe(1);
  expect(notifications).toEqual(["02"]);
});
test("out-of-order push cannot advance the durable replay cursor and reconnect catches missing messages", async () => {
  const cursors: (string | undefined)[] = [];
  let replay = false;
  const chat = new RoomChat(
    async (_room, after) => {
      cursors.push(after);
      return replay
        ? { items: [m("02"), m("03")], nextCursor: null }
        : { items: [m("01")], nextCursor: null };
    },
    () => {},
    () => {},
  );
  await chat.enter("a", "self");
  chat.receive("a", m("03"));
  replay = true;
  await chat.sync();
  expect(cursors).toEqual([undefined, "01"]);
  expect(chat.snapshot().items.map((m) => m.id)).toEqual(["01", "02", "03"]);
  expect(chat.snapshot().unread).toBe(2);
});
test("late history from a previous room never appears in the new room", async () => {
  let finish!: (p: { items: ReturnType<typeof m>[]; nextCursor: null }) => void;
  const chat = new RoomChat(
    async (room) =>
      room === "old"
        ? new Promise((r) => {
            finish = r;
          })
        : { items: [m("10")], nextCursor: null },
    () => {},
    () => {},
  );
  const old = chat.enter("old", "self");
  await chat.enter("new", "self");
  finish({ items: [m("01")], nextCursor: null });
  await old;
  chat.receive("old", m("02"));
  expect(chat.snapshot().roomId).toBe("new");
  expect(chat.snapshot().items.map((m) => m.id)).toEqual(["10"]);
  expect(chat.snapshot().unread).toBe(0);
  chat.leave();
  expect(chat.snapshot().items).toEqual([]);
});

test("an empty baseline replays every page of a later backlog", async () => {
  const cursors: (string | undefined)[] = [];
  const chat = new RoomChat(
    async (_room, after) => {
      cursors.push(after);
      if (!after) return { items: [], nextCursor: null };
      if (after === "start")
        return { items: [m("01"), m("02")], nextCursor: "02" };
      return { items: [m("03")], nextCursor: null };
    },
    () => {},
    () => {},
  );
  await chat.enter("room", "self");
  await chat.sync();
  expect(cursors).toEqual([undefined, "start", "02"]);
  expect(chat.snapshot().unread).toBe(3);
});
