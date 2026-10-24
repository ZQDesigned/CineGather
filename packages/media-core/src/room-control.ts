import { ROOM_CONTROL_TOPIC, roomControlSchema } from "@cinegather/contracts";
export function decodeRoomControl(
  payload: Uint8Array,
  topic: string | undefined,
  senderIdentity: string | undefined,
  roomId: string,
) {
  // Unknown/disconnected peers also have no Participant object. Check the raw
  // sender identity: only a server packet has the empty identity.
  if (topic !== ROOM_CONTROL_TOPIC || senderIdentity !== "") return;
  try {
    const parsed = roomControlSchema.safeParse(
      JSON.parse(new TextDecoder().decode(payload)),
    );
    if (parsed.success && parsed.data.roomId === roomId) return parsed.data;
  } catch {
    /* Ignore malformed data without altering capture state. */
  }
}
