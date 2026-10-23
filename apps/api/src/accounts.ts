import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { users, credentials, type Transaction } from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { db, hash, token, audit } from "./context";
import { fail } from "./errors";
import { clearUserMedia } from "./auth";
import {
  hashAccountPassword,
  verifyAccountPassword,
  dummyAccountHash,
} from "./account-passwords";
import { readRegistrationPolicy, registrationLock } from "./registration";
import { readAccess } from "./access";
const failures = new Map<string, { count: number; until: number }>();
async function session(tx: Transaction, user: User) {
  const sessionToken = token();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);
  await tx.insert(credentials).values({
    id: randomUUID(),
    userId: user.id,
    kind: "account",
    secretHash: hash(sessionToken),
    expiresAt,
  });
  return { user, sessionToken, expiresAt: expiresAt.toISOString() };
}
async function publicUser(
  tx: Transaction,
  user: typeof users.$inferSelect,
): Promise<User> {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    ...(await readAccess(tx, user.id, user.isSuperAdmin)),
  };
}
function uniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    ("code" in error && error.code === "23505") ||
    ("cause" in error && uniqueConflict(error.cause))
  );
}
export async function registerAccount(
  input: { username: string; displayName: string; password: string },
  existing?: User,
) {
  if (existing) fail(409, "ALREADY_REGISTERED", "请先退出当前账号后再注册");
  if (!(await readRegistrationPolicy()).enabled)
    fail(403, "REGISTRATION_CLOSED", "当前暂未开放注册，请登录已有账号");
  const passwordHash = await hashAccountPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock_shared(${registrationLock})`,
      );
      if (!(await readRegistrationPolicy(tx)).enabled)
        fail(403, "REGISTRATION_CLOSED", "当前暂未开放注册，请登录已有账号");
      const [stored] = await tx
        .insert(users)
        .values({
          id: randomUUID(),
          username: input.username,
          displayName: input.displayName,
          passwordHash,
        })
        .returning();
      const result = await session(tx, await publicUser(tx, stored!));
      await audit(tx, stored!.id, "account.registered", stored!.id);
      return result;
    });
  } catch (error) {
    if (uniqueConflict(error))
      fail(409, "USERNAME_TAKEN", "用户名已被使用，请换一个");
    throw error;
  }
}
export async function loginAccount(
  input: { username: string; password: string },
  address: string,
) {
  const key = `${address}:${input.username}`;
  const now = Date.now();
  if (failures.size >= 10000) {
    for (const [name, entry] of failures)
      if (entry.until <= now) failures.delete(name);
    if (failures.size >= 10000)
      fail(429, "AUTH_RATE_LIMITED", "登录尝试过于频繁，请稍后重试");
  }
  const previous = failures.get(key);
  const entry =
    previous && previous.until > now
      ? previous
      : { count: 0, until: now + 15 * 60_000 };
  if (entry.count >= 8)
    fail(429, "AUTH_RATE_LIMITED", "登录尝试过于频繁，请稍后重试");
  // Reserve before awaiting KDF so concurrent failures cannot bypass the limit.
  entry.count++;
  failures.set(key, entry);
  const [candidate] = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username));
  const correct = await verifyAccountPassword(
    input.password,
    candidate?.passwordHash ?? dummyAccountHash,
  );
  if (!candidate || !correct) fail(401, "LOGIN_FAILED", "用户名或密码不正确");
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, candidate.id))
      .for("update");
    if (!current || current.passwordHash !== candidate.passwordHash)
      fail(401, "LOGIN_FAILED", "用户名或密码不正确");
    if (current.disabledAt)
      fail(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员");
    failures.delete(key);
    const result = await session(tx, await publicUser(tx, current));
    await audit(tx, current.id, "account.logged_in", current.id);
    return result;
  });
}
export async function changeAccountPassword(
  user: User,
  input: { currentPassword: string; password: string },
) {
  const [candidate] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id));
  if (!candidate?.passwordHash) fail(403, "ACCOUNT_REQUIRED", "请先登录账号");
  if (
    !(await verifyAccountPassword(
      input.currentPassword,
      candidate.passwordHash,
    ))
  )
    fail(403, "PASSWORD_INVALID", "当前密码不正确");
  const passwordHash = await hashAccountPassword(input.password);
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .for("update");
    if (current?.passwordHash !== candidate.passwordHash)
      fail(409, "PASSWORD_CHANGED", "密码已变更，请重新登录");
    if (current!.disabledAt)
      fail(401, "ACCOUNT_DISABLED", "账号已停用，请联系管理员");
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await tx
      .update(credentials)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(credentials.userId, user.id), isNull(credentials.revokedAt)),
      );
    await audit(tx, user.id, "account.password_changed", user.id);
    return session(tx, await publicUser(tx, current!));
  });
  await clearUserMedia(user.id);
  return result;
}
