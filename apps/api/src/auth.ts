import { users, credentials } from '@cinegather/database';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, token, hash, audit } from './context';
import { fail } from './errors';
import type { User } from '@cinegather/contracts';
export async function createGuest(displayName: string) {
  const sessionToken = token(); const id = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await db.transaction(async tx => {
    await tx.insert(users).values({ id, displayName });
    await tx.insert(credentials).values({ id: randomUUID(), userId: id, kind: 'guest', secretHash: hash(sessionToken), expiresAt });
    await audit(tx, id, 'session.created', id);
  });
  return { user: { id, displayName }, sessionToken, expiresAt: expiresAt.toISOString() };
}
export async function authenticate(authorization?: string): Promise<User> {
  if (!authorization?.startsWith('Bearer ') || authorization.length > 256) fail(401, 'UNAUTHENTICATED', '请先建立访客身份');
  const [user] = await db.select({ id: users.id, displayName: users.displayName }).from(credentials).innerJoin(users, eq(credentials.userId, users.id)).where(and(eq(credentials.secretHash, hash(authorization.slice(7))), isNull(credentials.revokedAt), gt(credentials.expiresAt, new Date())));
  if (!user) fail(401, 'SESSION_EXPIRED', '身份已过期，请重新进入');
  return user;
}
export async function revokeSession(authorization: string) {
  await db.update(credentials).set({ revokedAt: new Date() }).where(eq(credentials.secretHash, hash(authorization.slice(7))));
}
