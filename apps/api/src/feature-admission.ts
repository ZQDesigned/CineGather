import type { User } from "@cinegather/contracts";
import { rooms } from "@cinegather/database";
import { eq } from "drizzle-orm";
import { db } from "./context";
import { requireFeature, requireRoomFeature } from "./feature-policy";
export async function checkRoomRequestCompatibility(
  user: User,
  method: string,
  path: string,
  raw: unknown,
) {
  const match = /^\/api\/v1\/rooms\/([0-9a-f-]{36})(?:\/|$)/i.exec(path);
  if (!match) return;
  const body =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // Releasing publications and stopping an existing subscription must remain possible.
  if (
    method === "DELETE" ||
    (method === "POST" && path.endsWith("/leave")) ||
    (path.endsWith("/watch") &&
      ["stop", "cancel"].includes(String(body.action))) ||
    (path.endsWith("/monitor") &&
      body.enabled !== true &&
      body.autoMonitor !== true)
  )
    return;
  const [room] = await db.select().from(rooms).where(eq(rooms.id, match[1]!));
  if (!room) return;
  requireRoomFeature(user, room);
  if (
    path.includes("/esports/") &&
    method === "POST" &&
    path.endsWith("/watch") &&
    body.action !== "stop"
  )
    requireFeature(user, "screen.watch");
}
