import { z } from "zod";
import {
  nativeOwner,
  type MemberOverlayPosition,
  type MemberOverlaySnapshot,
} from "@cinegather/contracts";

// Only display data crosses into the isolated overlay renderer.
export const overlaySnapshotSchema = z.object({
  roomId: z.string().min(1).max(64),
  roomName: z.string().max(128),
  members: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().max(64),
        local: z.boolean(),
        owner: z.boolean(),
        microphone: z.boolean(),
        speaking: z.boolean(),
        sharing: z.boolean(),
      }),
    )
    .max(10),
});
interface OverlayInput {
  user?: { id: string };
  room?: {
    id: string;
    name: string;
    ownerUserId: string;
    memberPermissions?: Array<{ userId: string; microphoneAllowed: boolean }>;
  };
  requiredUpdate?: unknown;
  roomState: string;
  media: {
    state: string;
    participants: Array<{
      id: string;
      name: string;
      local: boolean;
      microphone: boolean;
      speaking: boolean;
      microphoneAllowed?: boolean;
    }>;
    sharer?: { id: string };
  };
}
export function buildMemberOverlay(
  state: OverlayInput,
): MemberOverlaySnapshot | null {
  const { room, media } = state;
  if (
    !state.user ||
    !room ||
    state.requiredUpdate ||
    state.roomState !== "connected" ||
    media.state !== "connected"
  )
    return null;
  return {
    roomId: room.id,
    roomName: room.name.slice(0, 128),
    members: media.participants
      .filter((p) => !nativeOwner(p.id))
      .slice(0, 10)
      .map((p) => {
        const microphone =
          p.microphone &&
          p.microphoneAllowed !== false &&
          room.memberPermissions?.find((m) => m.userId === p.id)
            ?.microphoneAllowed !== false;
        return {
          id: p.id,
          name: p.name.slice(0, 64),
          local: p.local,
          owner: p.id === room.ownerUserId,
          microphone,
          speaking: microphone && p.speaking,
          sharing: media.sharer?.id === p.id,
        };
      }),
  };
}
export interface OverlayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function overlayBounds(
  position: MemberOverlayPosition,
  count: number,
  area: OverlayArea,
): OverlayArea {
  const width = Math.min(256, Math.max(1, area.width - 16));
  const height = Math.min(
    42 + 38 * Math.min(10, Math.max(0, count)),
    Math.max(1, area.height - 16),
  );
  const x = position.startsWith("left")
    ? area.x + 8
    : area.x + area.width - width - 8;
  const y = position.endsWith("center")
    ? area.y + (area.height - height) / 2
    : position.endsWith("bottom")
      ? area.y + area.height - height - 8
      : area.y + 8;
  return { x: Math.round(x), y: Math.round(y), width, height };
}
