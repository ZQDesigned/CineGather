import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  users,
  credentials,
  members,
  rooms,
  type Transaction,
} from "@cinegather/database";
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
import { sessionDevice } from "./session-device";
import { media } from "./media";
const failures = new Map<string, { count: number; until: number }>();
async function session(
  tx: Transaction,
  user: User,
  device?: ReturnType<typeof sessionDevice>,
) {
  const sessionToken = token();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);
  await tx.insert(credentials).values({
    id: randomUUID(),
    userId: user.id,
    kind: "account",
    createdAt: new Date(),
    ...device,
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
    screenShareEnabled: user.screenShareEnabled,
    gameHostEnabled: user.gameHostEnabled,
    esportsRoomsEnabled: user.esportsRoomsEnabled,
    highFrameRateEnabled: user.highFrameRateEnabled,
    standardRoomMaxMembers: user.standardRoomMaxMembers,
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
  device?: ReturnType<typeof sessionDevice>,
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
      const policy = await readRegistrationPolicy(tx);
      if (!policy.enabled)
        fail(403, "REGISTRATION_CLOSED", "当前暂未开放注册，请登录已有账号");
      const [stored] = await tx
        .insert(users)
        .values({
          id: randomUUID(),
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          screenShareEnabled: policy.screenShareDefaultEnabled,
          gameHostEnabled: policy.gameHostDefaultEnabled,
        })
        .returning();
      const result = await session(tx, await publicUser(tx, stored!), device);
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
  device?: ReturnType<typeof sessionDevice>,
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
    const result = await session(tx, await publicUser(tx, current), device);
    await audit(tx, current.id, "account.logged_in", current.id);
    return result;
  });
}
export async function changeAccountProfile(
  user: User,
  input: { displayName: string },
) {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .for("update");
    if (!current?.username || current.disabledAt)
      fail(401, "ACCOUNT_REQUIRED", "请重新登录账号");
    if (current.displayName !== input.displayName) {
      await tx
        .update(users)
        .set({ displayName: input.displayName })
        .where(eq(users.id, user.id));
      await audit(tx, user.id, "account.profile_updated", user.id, {
        displayName: { before: current.displayName, after: input.displayName },
      });
    }
    return publicUser(tx, { ...current, displayName: input.displayName });
  });
  // Persisted profile is authoritative. A temporarily unavailable media service
  // must not turn a successful save into a failure; reconciliation retries it.
  try {
    const active = await db
      .select({ id: rooms.id })
      .from(members)
      .innerJoin(rooms, eq(rooms.id, members.roomId))
      .where(
        and(
          eq(members.userId, user.id),
          eq(rooms.status, "active"),
          eq(rooms.mode, "standard"),
        ),
      );
    for (const room of active) {
      const [current] = await db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, user.id));
      if (!current) break;
      for (const peer of await media.participants(room.id))
        if (peer.identity === user.id && peer.name !== current.name)
          await media.client.updateParticipant(room.id, peer.rawIdentity, {
            name: current.name,
          });
    }
  } catch {
    console.error(
      JSON.stringify({
        event: "account.profile_media_sync_failed",
        userId: user.id,
      }),
    );
  }
  return result;
}
export async function changeAccountPassword(
  user: User,
  input: { currentPassword: string; password: string },
  device?: ReturnType<typeof sessionDevice>,
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
    return session(tx, await publicUser(tx, current!), device);
  });
  await clearUserMedia(user.id);
  return result;
}
