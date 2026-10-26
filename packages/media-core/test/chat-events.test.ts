import { expect, test } from "bun:test";
import { ROOM_CHAT_TOPIC } from "@cinegather/contracts";
import { decodeRoomChat } from "../src/chat-events";
test("chat only accepts bounded server-originated messages for the current room", () => {
  const roomId = crypto.randomUUID();
  const message = {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    displayName: "朋友",
    body: "你好",
    createdAt: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify({ roomId, message }));
  expect(decodeRoomChat(bytes, ROOM_CHAT_TOPIC, "", roomId)).toEqual(message);
  for (const sender of ["peer-id", undefined])
    expect(
      decodeRoomChat(bytes, ROOM_CHAT_TOPIC, sender, roomId),
    ).toBeUndefined();
  expect(
    decodeRoomChat(bytes, ROOM_CHAT_TOPIC, "", crypto.randomUUID()),
  ).toBeUndefined();
  expect(decodeRoomChat(bytes, "other", "", roomId)).toBeUndefined();
  expect(
    decodeRoomChat(new Uint8Array(16385), ROOM_CHAT_TOPIC, "", roomId),
  ).toBeUndefined();
});
