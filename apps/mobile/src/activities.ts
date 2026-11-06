import { RoomActivityClient } from "@cinegather/client-core";
import type { ActivityTarget, ActivitySnapshot } from "@cinegather/contracts";
import { runtime } from "./runtime";
// React Native synthesizes an HTTP Origin for native sockets. Use the same
// explicit app origin as the desktop bridge; admission still requires a fresh,
// single-use ticket from the authenticated API.
const NativeActivitySocket = WebSocket as unknown as {
  new (
    url: string,
    protocols: undefined,
    options: { headers: { Origin: string } },
  ): WebSocket;
};
export const activities = new RoomActivityClient({
  socket: (url) =>
    new NativeActivitySocket(url, undefined, {
      headers: { Origin: "app://cinegather" },
    }),
  origin: () => runtime.origin,
  ticket: (roomId) =>
    runtime.api.call("activity-ticket", (c) =>
      c.POST("/api/v1/rooms/{roomId}/activity/ticket", {
        params: { path: { roomId } },
      }),
    ),
});
export async function startActivity(
  target: ActivityTarget,
  requestId?: string,
  historyId?: string,
  expected?: Pick<ActivitySnapshot, "roomId" | "generation">,
) {
  if (expected) activities.assertContext(expected);
  const snapshot = activities.getSnapshot().snapshot;
  if (!snapshot) throw Error("活动尚未连接，请稍后重试");
  await activities.command({
    type: "start",
    target,
    generation: snapshot.generation,
    requestId,
    historyId,
  });
}
