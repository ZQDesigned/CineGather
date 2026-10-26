import { ROOM_CHAT_TOPIC, roomChatEventSchema } from "@cinegather/contracts";
export function decodeRoomChat(
  payload: Uint8Array,
  topic: string | undefined,
  senderIdentity: string | undefined,
  roomId: string,
) {
  if (
    topic !== ROOM_CHAT_TOPIC ||
    senderIdentity !== "" ||
    payload.byteLength > 16384
  )
    return;
  try {
    const value = roomChatEventSchema.safeParse(
      JSON.parse(new TextDecoder().decode(payload)),
    );
    if (value.success && value.data.roomId === roomId)
      return value.data.message;
  } catch {
    /* Ignore untrusted or malformed room data. */
  }
}
