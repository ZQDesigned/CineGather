import { and, eq, gt, isNull } from "drizzle-orm";
import { users, credentials } from "@cinegather/database";
import { db } from "./context";
import { fail } from "./errors";

export const presenceLifetimeMs = 90_000;
export async function heartbeatPresence(userId: string, credentialId: string) {
  const now = new Date();
  const updated = await db
    .update(credentials)
    .set({ presenceAt: now })
    .where(
      and(
        eq(credentials.id, credentialId),
        eq(credentials.userId, userId),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, now),
      ),
    )
    .returning({ id: credentials.id });
  if (!updated.length)
    fail(401, "SESSION_EXPIRED", "登录已失效，请重新登录账号");
  return readPresence(userId);
}
export async function readPresence(userId: string) {
  const [user] = await db
    .select({ visibility: users.presenceVisibility })
    .from(users)
    .where(eq(users.id, userId));
  return { visibility: user!.visibility as "online" | "invisible" };
}
export async function setPresence(
  userId: string,
  visibility: "online" | "invisible",
) {
  await db
    .update(users)
    .set({ presenceVisibility: visibility })
    .where(eq(users.id, userId));
  return { visibility };
}
