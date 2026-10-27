import { and, eq, gt, isNull, ne, desc, or, sql } from "drizzle-orm";
import { credentials } from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { db, audit } from "./context";
import { uuid, fail } from "./errors";
import { sessionCredential } from "./session-context";
import { clearSessionMedia } from "./auth";
export async function listSessions(user: User) {
  const rows = await db
    .select({
      id: credentials.id,
      deviceName: credentials.deviceName,
      clientPlatform: credentials.clientPlatform,
      clientVersion: credentials.clientVersion,
      createdAt: credentials.createdAt,
      lastActiveAt: credentials.presenceAt,
      loginAddress: credentials.loginAddress,
      expiresAt: credentials.expiresAt,
    })
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, user.id),
        eq(credentials.kind, "account"),
        isNull(credentials.revokedAt),
        gt(credentials.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(credentials.presenceAt));
  return {
    items: rows.map((r) => ({
      ...r,
      current: r.id === sessionCredential(user),
      createdAt: r.createdAt?.toISOString() ?? null,
      lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    })),
  };
}
export async function revokeDevices(user: User, id?: string) {
  const rows = await db.transaction(async (tx) => {
    const rows = await tx
      .update(credentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(credentials.userId, user.id),
          id
            ? undefined
            : or(
                isNull(credentials.revokedAt),
                sql`EXISTS (SELECT 1 FROM room_sessions WHERE credential_id = ${credentials.id} AND admitted_until IS NOT NULL)`,
              ),
          id
            ? eq(credentials.id, uuid(id))
            : ne(credentials.id, sessionCredential(user)!),
        ),
      )
      .returning({ id: credentials.id });
    if (id && !rows.length)
      fail(404, "SESSION_NOT_FOUND", "设备已退出或不存在");
    if (rows.length)
      await audit(tx, user.id, "sessions.revoked", user.id, {
        sessionIds: rows.map((r) => r.id),
      });
    return rows;
  });
  await Promise.all(rows.map((r) => clearSessionMedia(user.id, r.id)));
  return { ok: true as const };
}
