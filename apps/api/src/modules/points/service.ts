import { pointsEntryHash as fingerprint } from "./audit-hash";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import {
  pointsLedger,
  pointsPolicies,
  pointsWallets,
  users,
  type Transaction,
} from "@cinegather/database";
import {
  pointsEntrySchema,
  pointsPolicyInput,
  pointsRulesSchema,
  type PointsRules,
  type User,
  type pointsQuerySchema,
} from "@cinegather/contracts";
import type { z } from "zod";
import { db, audit } from "../../core/context";
import { fail, uuid } from "../../core/errors";
import { requireManagement } from "../accounts/access";
import { pointsDay, awardedAmount } from "./model";

type LedgerRow = typeof pointsLedger.$inferSelect;
function publicEntry(row: LedgerRow) {
  return pointsEntrySchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}
function policyView(row: typeof pointsPolicies.$inferSelect) {
  return {
    ...pointsRulesSchema.parse(row.rules),
    version: row.version,
    reason: row.reason,
    actorName: row.actorName,
    actorUsername: row.actorUsername,
    createdAt: row.createdAt.toISOString(),
  };
}
export async function readPointsPolicy(tx: Pick<Transaction, "select"> = db) {
  const [row] = await tx
    .select()
    .from(pointsPolicies)
    .orderBy(desc(pointsPolicies.version))
    .limit(1);
  if (!row) throw Error("Points policy migration is missing");
  return policyView(row);
}
export async function updatePointsPolicy(
  user: User,
  raw: z.infer<typeof pointsPolicyInput>,
) {
  const input = pointsPolicyInput.parse(raw);
  return db.transaction(async (tx) => {
    await requireManagement(tx, user.id, "points.manage");
    await tx.execute(sql`select pg_advisory_xact_lock(74921009)`);
    const before = await readPointsPolicy(tx);
    if (before.version !== input.version)
      fail(409, "POINTS_POLICY_CHANGED", "积分规则已更新，请刷新后重试");
    const [account] = await tx
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    const [row] = await tx
      .insert(pointsPolicies)
      .values({
        version: before.version + 1,
        rules: pointsRulesSchema.parse({
          enabled: input.enabled,
          dailyCap: input.dailyCap,
          games: input.games,
        }),
        reason: input.reason,
        actorId: user.id,
        actorName: account!.displayName,
        actorUsername: account!.username,
      })
      .returning();
    await audit(tx, user.id, "admin.points_policy_updated", undefined, {
      before,
      after: policyView(row!),
      reason: input.reason,
    });
    return policyView(row!);
  });
}
export interface SettlementInput {
  userId: string;
  roomId: string;
  matchId: string;
  roundId: string;
  game: string;
  reward: string;
  attempt: number;
  expected: number;
  policy: { version: number; rules: PointsRules };
  traceId: string;
  facts?: Record<string, unknown>;
}
/** Internal-only: game adapters provide authoritative facts. Never expose as HTTP input. */
export async function settlePoints(tx: Transaction, input: SettlementInput) {
  const {
    userId,
    roomId,
    matchId,
    roundId,
    game,
    reward,
    attempt,
    expected,
    policy,
    traceId,
  } = input;
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected > 100000 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0
  )
    throw Error("Invalid reward fact");
  await tx
    .insert(pointsWallets)
    .values({ userId, day: pointsDay() })
    .onConflictDoNothing();
  const [wallet] = await tx
    .select()
    .from(pointsWallets)
    .where(eq(pointsWallets.userId, userId))
    .for("update");
  const now = new Date(),
    day = pointsDay(now);
  const [existing] = await tx
    .select()
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.userId, userId),
        eq(pointsLedger.game, game),
        eq(pointsLedger.matchId, matchId),
        eq(pointsLedger.roundId, roundId),
        eq(pointsLedger.reward, reward),
      ),
    );
  if (existing) return publicEntry(existing);
  const [account] = await tx.select().from(users).where(eq(users.id, userId));
  if (!account?.username || account.disabledAt)
    fail(403, "POINTS_ACCOUNT_UNAVAILABLE", "账号当前无法参与积分结算");
  const current = await readPointsPolicy(tx);
  const earned =
    wallet!.day === day
      ? wallet!.earned
      : Number(
          (
            await tx
              .select({
                value: sql<string>`coalesce(sum(${pointsLedger.amount}),0)`,
              })
              .from(pointsLedger)
              .where(
                and(eq(pointsLedger.userId, userId), eq(pointsLedger.day, day)),
              )
          )[0]!.value,
        );
  const amount =
    current.enabled && policy.rules.enabled
      ? awardedAmount(expected, earned, current.dailyCap)
      : 0;
  const outcome =
    !current.enabled || !policy.rules.enabled
      ? "disabled"
      : expected === 0
        ? "no_reward"
        : amount < expected
          ? "capped"
          : "awarded";
  const before = wallet!.balance,
    after = before + amount;
  if (!Number.isSafeInteger(after))
    throw Error("Points balance exceeds safe integer range");
  const encodedFacts = JSON.stringify(input.facts ?? {});
  if (encodedFacts.length > 16384)
    throw Error("Reward facts exceed audit limit");
  const facts = JSON.parse(encodedFacts) as Record<string, unknown>;
  const entry = {
    facts,
    id: randomUUID(),
    userId,
    sequence: wallet!.sequence + 1,
    displayName: account.displayName,
    username: account.username,
    roomId,
    matchId,
    roundId,
    game,
    reward,
    attempt,
    expected,
    amount,
    before,
    after,
    day,
    outcome,
    appliedCap: current.dailyCap,
    settlementPolicyVersion: current.version,
    policyVersion: policy.version,
    policy: policy.rules,
    traceId,
    previousHash: wallet!.headHash,
    createdAt: now,
  } satisfies Omit<LedgerRow, "entryHash">;
  const entryHash = fingerprint(entry);
  const [saved] = await tx
    .insert(pointsLedger)
    .values({ ...entry, entryHash })
    .returning();
  await tx
    .update(pointsWallets)
    .set({
      balance: after,
      day,
      earned: earned + amount,
      sequence: entry.sequence,
      headHash: entryHash,
    })
    .where(eq(pointsWallets.userId, userId));
  return publicEntry(saved!);
}
export async function readPointsSummary(tx: Transaction, userId: string) {
  const policy = await readPointsPolicy(tx);
  // One MVCC statement keeps the wallet and its receipt consistent even when
  // the first-ever settlement commits while this request is reading.
  const [row] = await tx
    .select({ wallet: pointsWallets, latest: pointsLedger })
    .from(pointsWallets)
    .leftJoin(
      pointsLedger,
      and(
        eq(pointsLedger.userId, pointsWallets.userId),
        eq(pointsLedger.sequence, pointsWallets.sequence),
      ),
    )
    .where(eq(pointsWallets.userId, userId));
  const day = pointsDay(),
    wallet = row?.wallet,
    latest = row?.latest;
  const todayEarned =
    wallet?.day === day
      ? wallet.earned
      : Number(
          (
            await tx
              .select({
                value: sql<string>`coalesce(sum(${pointsLedger.amount}),0)`,
              })
              .from(pointsLedger)
              .where(
                and(eq(pointsLedger.userId, userId), eq(pointsLedger.day, day)),
              )
          )[0]!.value,
        );
  return {
    balance: wallet?.balance ?? 0,
    todayEarned,
    dailyCap: policy.dailyCap,
    remaining: policy.enabled ? Math.max(0, policy.dailyCap - todayEarned) : 0,
    day,
    enabled: policy.enabled,
    latest: latest ? publicEntry(latest) : null,
  };
}
export async function listPoints(
  user: User,
  query: z.infer<typeof pointsQuerySchema>,
  admin = false,
) {
  return db.transaction(async (tx) => {
    if (admin) await requireManagement(tx, user.id, "points.read");
    const q = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    const where = and(
      admin ? undefined : eq(pointsLedger.userId, user.id),
      admin ? undefined : gt(pointsLedger.amount, 0),
      query.game ? eq(pointsLedger.game, query.game) : undefined,
      query.today === "true" ? eq(pointsLedger.day, pointsDay()) : undefined,
      admin && query.q
        ? or(
            ilike(pointsLedger.displayName, q),
            ilike(pointsLedger.username, q),
            sql`${pointsLedger.id}::text ilike ${q}`,
          )
        : undefined,
    );
    const rows = await tx
      .select()
      .from(pointsLedger)
      .where(where)
      .orderBy(
        desc(pointsLedger.createdAt),
        desc(pointsLedger.sequence),
        pointsLedger.id,
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(pointsLedger)
      .where(where);
    return {
      items: rows.map((row) =>
        admin
          ? { ...row, createdAt: row.createdAt.toISOString() }
          : publicEntry(row),
      ),
      total: total!.count,
    };
  });
}
export async function readOwnPointsEntry(user: User, id: string) {
  const [row] = await db
    .select()
    .from(pointsLedger)
    .where(
      and(eq(pointsLedger.id, uuid(id)), eq(pointsLedger.userId, user.id)),
    );
  if (!row) fail(404, "POINTS_ENTRY_NOT_FOUND", "积分记录不存在");
  return publicEntry(row);
}
export async function pointsPolicyHistory(user: User, page = 1) {
  return db.transaction(async (tx) => {
    await requireManagement(tx, user.id, "points.read");
    const items = await tx
      .select()
      .from(pointsPolicies)
      .orderBy(desc(pointsPolicies.version))
      .limit(20)
      .offset((page - 1) * 20);
    const [count] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(pointsPolicies);
    return { items: items.map(policyView), total: count!.value };
  });
}
export async function verifyPointsAccount(userId: string, pageSize = 250) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw Error("Invalid audit page size");
  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, userId));
    const watermark = wallet?.sequence ?? 0;
    let balance = 0,
      previousHash = "",
      sequence = 0;
    const daily = new Map<string, number>();
    while (sequence < watermark) {
      const rows = await tx
        .select()
        .from(pointsLedger)
        .where(
          and(
            eq(pointsLedger.userId, userId),
            gt(pointsLedger.sequence, sequence),
            sql`${pointsLedger.sequence}<=${watermark}`,
          ),
        )
        .orderBy(pointsLedger.sequence)
        .limit(pageSize);
      if (!rows.length) return { ok: false, entries: sequence };
      for (const row of rows) {
        const { entryHash, ...payload } = row;
        if (
          row.amount >
            awardedAmount(
              row.expected,
              daily.get(row.day) ?? 0,
              row.appliedCap,
            ) ||
          row.sequence !== ++sequence ||
          row.before !== balance ||
          row.after !== balance + row.amount ||
          row.previousHash !== previousHash ||
          entryHash !== fingerprint(payload)
        )
          return { ok: false, entries: sequence };
        daily.set(row.day, (daily.get(row.day) ?? 0) + row.amount);
        balance = row.after;
        previousHash = entryHash;
      }
    }
    return {
      ok:
        (wallet?.earned ?? 0) === (daily.get(wallet?.day ?? "") ?? 0) &&
        (wallet?.balance ?? 0) === balance &&
        (wallet?.sequence ?? 0) === sequence &&
        (wallet?.headHash ?? "") === previousHash,
      entries: sequence,
    };
  });
}

export async function adminPointsPolicy(user: User) {
  return db.transaction(async (tx) => {
    await requireManagement(tx, user.id, "points.read");
    return readPointsPolicy(tx);
  });
}
