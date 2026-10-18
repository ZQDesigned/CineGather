import { createDatabase, auditLogs, idempotency, type Transaction } from '@cinegather/database';
import { sql, and, eq } from 'drizzle-orm';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config';
import { fail } from './errors';
export const database = createDatabase(config.databaseUrl);
export const db = database.db;
export const hash = (value: string) => createHmac('sha256', config.sessionSecret).update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export async function audit(tx: Transaction, actorId: string | null, action: string, targetId?: string, details: Record<string, unknown> = {}) {
  await tx.insert(auditLogs).values({ id: randomUUID(), actorId, action, targetId, details });
}
export async function dedup<T>(tx: Transaction, userId: string, key: string | undefined, operation: string, payload: unknown, run: () => Promise<T>): Promise<T> {
  if (!key) return run();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY', '幂等请求标识无效');
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${key}`}, 0))`);
  const [previous] = await tx.select().from(idempotency).where(and(eq(idempotency.userId, userId), eq(idempotency.key, key)));
  const requestHash = hash(JSON.stringify(payload));
  if (previous) {
    if (previous.operation !== operation || previous.requestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他操作');
    return previous.response as T;
  }
  const response = await run();
  await tx.insert(idempotency).values({ userId, key, operation, requestHash, response });
  return response;
}
