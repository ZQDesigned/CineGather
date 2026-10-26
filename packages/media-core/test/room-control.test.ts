import { expect, test } from "bun:test";
import { ROOM_CONTROL_TOPIC } from "@cinegather/contracts";
import { decodeRoomControl } from "../src/room-control";
const roomId = "c83073bf-ad00-4a97-b90e-0d7c20d54f62";
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
test("only correctly scoped server-origin controls can change capture state; peers and unmute commands are ignored", () => {
  const mute = { action: "mute-microphone" as const, roomId };
  expect(
    decodeRoomControl(encode(mute), ROOM_CONTROL_TOPIC, "", roomId),
  ).toEqual(mute);
  for (const sender of ["member-id", undefined])
    expect(
      decodeRoomControl(encode(mute), ROOM_CONTROL_TOPIC, sender, roomId),
    ).toBeUndefined();
  expect(decodeRoomControl(encode(mute), "chat", "", roomId)).toBeUndefined();
  expect(
    decodeRoomControl(
      encode(mute),
      ROOM_CONTROL_TOPIC,
      "",
      crypto.randomUUID(),
    ),
  ).toBeUndefined();
  for (const invalid of [
    { ...mute, action: "unmute-microphone" },
    { ...mute, muted: false },
    { action: "stop-share", roomId },
    null,
    "invalid",
  ])
    expect(
      decodeRoomControl(encode(invalid), ROOM_CONTROL_TOPIC, "", roomId),
    ).toBeUndefined();
  expect(
    decodeRoomControl(new Uint8Array([123]), ROOM_CONTROL_TOPIC, "", roomId),
  ).toBeUndefined();
});

test("only server-originated accompaniment stops are accepted for this room", () => {
  const stop = { action: "stop-accompaniment" as const, roomId };
  expect(
    decodeRoomControl(encode(stop), ROOM_CONTROL_TOPIC, "", roomId),
  ).toEqual(stop);
  expect(
    decodeRoomControl(encode(stop), ROOM_CONTROL_TOPIC, "peer", roomId),
  ).toBeUndefined();
  expect(
    decodeRoomControl(
      encode(stop),
      ROOM_CONTROL_TOPIC,
      "",
      crypto.randomUUID(),
    ),
  ).toBeUndefined();
});
