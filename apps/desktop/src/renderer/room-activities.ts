import { RoomActivityClient } from "@cinegather/client-core";
import { unwrap } from "@cinegather/api-client";
import type { ActivityTarget, ActivitySnapshot } from "@cinegather/contracts";
import {
  api,
  activityServerOrigin,
  prepareSharingQuality,
  shareSession,
} from "./controller";
export const roomActivities = new RoomActivityClient({
  origin: activityServerOrigin,
  ticket: async (roomId) =>
    unwrap(
      await api.POST("/api/v1/rooms/{roomId}/activity/ticket", {
        params: { path: { roomId } },
      }),
    ),
});
if (import.meta.hot) import.meta.hot.dispose(() => roomActivities.disconnect());
export async function startRoomActivity(
  target: ActivityTarget,
  requestId?: string,
  historyId?: string,
  expected?: Pick<ActivitySnapshot, "roomId" | "generation">,
) {
  if (expected) roomActivities.assertContext(expected);
  const snapshot = roomActivities.getSnapshot().snapshot;
  if (!snapshot) return;
  const command = {
    type: "start" as const,
    target,
    generation: snapshot.generation,
    requestId,
    historyId,
  };
  if (target === "screen") {
    const quality = await prepareSharingQuality();
    await shareSession.startHandoff(async () => {
      roomActivities.assertContext(snapshot);
      await roomActivities.command(command, snapshot);
      return unwrap(
        await api.POST("/api/v1/rooms/{roomId}/share-lease", {
          params: { path: { roomId: snapshot.roomId } },
          body: { quality },
        }),
      );
    });
  } else await roomActivities.command(command, snapshot);
}
