import {
  newPartyGame,
  partyCommand,
} from "../../apps/api/src/modules/party/party-game";
import {
  syncPartyRewards,
  advancePartyRewards,
} from "../../apps/api/src/modules/points/party-rewards";
import { beforeAll, afterAll, expect, test, setSystemTime } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  users,
  pointsLedger,
  pointsWallets,
  auditLogs,
} from "@cinegather/database";
import { defaultPointsRules, type User } from "@cinegather/contracts";
import { db } from "../../apps/api/src/core/context";
import {
  readPointsPolicy,
  settlePoints,
  readPointsSummary,
  updatePointsPolicy,
  listPoints,
  verifyPointsAccount,
} from "../../apps/api/src/modules/points/service";
let id: string, adminId: string;
const actor = () => ({ id: adminId, displayName: "测试超管" }) as User;
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("activities_tests"))
    throw Error("isolated database required");
  id = randomUUID();
  adminId = randomUUID();
  await db.insert(users).values([
    {
      id,
      displayName: "积分测试",
      passwordHash: "fixture",
      username: "points_" + id.slice(0, 8),
    },
    {
      id: adminId,
      displayName: "超管",
      passwordHash: "fixture",
      username: "root_" + adminId.slice(0, 8),
      isSuperAdmin: true,
    },
  ]);
});
afterAll(async () => {
  await db
    .update(auditLogs)
    .set({ actorId: null })
    .where(eq(auditLogs.actorId, adminId));
  await db.delete(users).where(eq(users.id, id));
  await db.delete(users).where(eq(users.id, adminId));
});
function input(overrides: Record<string, unknown> = {}) {
  return {
    userId: id,
    roomId: randomUUID(),
    matchId: randomUUID(),
    roundId: randomUUID(),
    game: "party.quiz",
    reward: "correct" as const,
    attempt: 1,
    expected: 10,
    policy: { version: 1, rules: structuredClone(defaultPointsRules) },
    traceId: randomUUID(),
    ...overrides,
  };
}
test("points concurrent cross-room settlements share the daily cap and form an auditable chain", async () => {
  await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      db.transaction((tx) =>
        settlePoints(tx, input({ game: i % 2 ? "party.draw" : "party.quiz" })),
      ),
    ),
  );
  const summary = await db.transaction((tx) => readPointsSummary(tx, id));
  expect(summary.balance).toBe(100);
  expect(summary.todayEarned).toBe(100);
  expect(summary.remaining).toBe(0);
  expect(await verifyPointsAccount(id, 5)).toEqual({ ok: true, entries: 15 });
});
test("points zero decisions remain idempotent after raising the cap, and rollbacks leave no partial state", async () => {
  const event = input();
  await db.transaction((tx) => settlePoints(tx, event));
  const policy = await readPointsPolicy();
  await updatePointsPolicy(actor(), {
    ...defaultPointsRules,
    version: policy.version,
    dailyCap: 200,
    reason: "验证上限变更",
  });
  const replay = await db.transaction((tx) => settlePoints(tx, event));
  expect(replay.amount).toBe(0);
  const aborted = input();
  await expect(
    db.transaction(async (tx) => {
      await settlePoints(tx, aborted);
      throw Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  const [row] = await db
    .select()
    .from(pointsLedger)
    .where(eq(pointsLedger.roundId, aborted.roundId));
  expect(row).toBeUndefined();
  expect(
    (await db.transaction((tx) => readPointsSummary(tx, id))).balance,
  ).toBe(100);
});
test("points administrators cannot rewrite history or grant points, policy updates are versioned and permissions checked", async () => {
  const user = { id, displayName: "积分测试" } as User;
  await expect(
    listPoints(user, { page: 1, pageSize: 20, today: "false", q: "" }, true),
  ).rejects.toThrow();
  const current = await readPointsPolicy();
  await expect(
    updatePointsPolicy(user, {
      ...defaultPointsRules,
      version: current.version,
      reason: "越权",
    }),
  ).rejects.toThrow();
  await expect(
    updatePointsPolicy(actor(), {
      ...defaultPointsRules,
      version: current.version - 1,
      reason: "过期",
    }),
  ).rejects.toThrow();
  await expect(
    db
      .execute(sql`update points_ledger set amount=999 where user_id=${id}`)
      .execute(),
  ).rejects.toThrow();
  await expect(
    db.execute(sql`delete from points_ledger where user_id=${id}`).execute(),
  ).rejects.toThrow();
  await expect(
    db.execute(sql`truncate points_ledger`).execute(),
  ).rejects.toThrow();
  await expect(
    db.execute(sql`update points_policies set reason='tamper'`).execute(),
  ).rejects.toThrow();
  const own = await listPoints(user, {
    page: 1,
    pageSize: 20,
    today: "false",
    q: "",
  });
  expect(own.items.every((e) => e.amount > 0)).toBe(true);
  expect(own.items[0]).not.toHaveProperty("userId");
  const [wallet] = await db
    .select()
    .from(pointsWallets)
    .where(eq(pointsWallets.userId, id));
  expect(wallet!.balance).toBe(100);
});

test("points game adapters pay only valid guesses and normally completed drawings, snapshot rewards by round", async () => {
  const ids = [randomUUID(), randomUUID()],
    roomId = randomUUID();
  await db.insert(users).values(
    ids.map((id) => ({
      id,
      username: "p_" + id.slice(0, 8),
      passwordHash: "fixture",
      displayName: "玩家",
    })),
  );
  try {
    let game = newPartyGame("draw");
    for (const id of ids)
      game = partyCommand(
        game,
        { id, name: "玩家" },
        { type: "ready", ready: true },
        10000,
      );
    const before = game;
    game = await db.transaction((tx) =>
      syncPartyRewards(
        tx,
        roomId,
        before,
        partyCommand(
          before,
          { id: ids[0]!, name: "玩家" },
          { type: "start" },
          10000,
        ),
      ),
    );
    game = partyCommand(
      game,
      { id: game.drawerId!, name: "玩家" },
      { type: "choose", index: 0 },
      10001,
    );
    game.drewThisRound = true;
    const drawer = game.drawerId!,
      guesser = ids.find((id) => id !== drawer)!;
    const next = partyCommand(
      game,
      { id: guesser, name: "玩家" },
      { type: "guess", answer: game.word!.answer },
      10002,
    );
    await db.transaction((tx) => syncPartyRewards(tx, roomId, game, next));
    await db.transaction((tx) => syncPartyRewards(tx, roomId, game, next));
    expect(
      (await db.transaction((tx) => readPointsSummary(tx, guesser))).balance,
    ).toBe(10);
    expect(
      (await db.transaction((tx) => readPointsSummary(tx, drawer))).balance,
    ).toBe(5);
    const second = await db.transaction((tx) =>
      advancePartyRewards(tx, roomId, next, next.deadline!),
    );
    const chosen = partyCommand(
      second,
      { id: second.drawerId!, name: "玩家" },
      { type: "choose", index: 0 },
      20000,
    );
    chosen.drewThisRound = true;
    const cancelled = partyCommand(
      chosen,
      { id: chosen.drawerId!, name: "玩家" },
      { type: "ready", ready: false },
      20001,
    );
    await db.transaction((tx) =>
      syncPartyRewards(tx, roomId, chosen, cancelled),
    );
    expect(
      (await db.transaction((tx) => readPointsSummary(tx, chosen.drawerId!)))
        .balance,
    ).toBe(10);
    // A normal timeout can award participation even when nobody solves the word.
    const timed = { ...chosen, roundId: randomUUID() };
    await db.transaction((tx) =>
      advancePartyRewards(tx, roomId, timed, timed.deadline!),
    );
    expect(
      (await db.transaction((tx) => readPointsSummary(tx, timed.drawerId!)))
        .balance,
    ).toBe(15);
  } finally {
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  }
});

test("points waiting on an account lock across midnight settle against the new accounting day", async () => {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    username: "midnight_" + userId.slice(0, 8),
    displayName: "跨日",
    passwordHash: "fixture",
  });
  await db.insert(pointsWallets).values({ userId, day: "2026-11-09" });
  let unlock = () => {},
    acquired = () => {};
  const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    }),
    locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
  const blocker = db.transaction(async (tx) => {
    await tx
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, userId))
      .for("update");
    acquired();
    await gate;
  });
  await locked;
  setSystemTime(new Date("2026-11-09T15:59:59.900Z"));
  const pending = db.transaction((tx) => settlePoints(tx, input({ userId })));
  try {
    let waiting = false;
    for (let i = 0; i < 80 && !waiting; i++) {
      const result = await db.execute(
        sql`select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%points_wallets%'`,
      );
      waiting = result.rows.length > 0;
      if (!waiting) await Bun.sleep(5);
    }
    expect(waiting).toBe(true);
    setSystemTime(new Date("2026-11-09T16:00:00.100Z"));
    unlock();
    await blocker;
    const entry = await pending;
    expect(entry.day).toBe("2026-11-10");
  } finally {
    unlock();
    await blocker;
    await pending;
    setSystemTime();
    await db.delete(users).where(eq(users.id, userId));
  }
});

test("points rewards keep their round policy while caps and disable controls take effect immediately", async () => {
  const ids = [randomUUID(), randomUUID()],
    roomId = randomUUID();
  await db.insert(users).values(
    ids.map((id) => ({
      id,
      username: "snapshot_" + id.slice(0, 8),
      passwordHash: "fixture",
      displayName: "快照玩家",
    })),
  );
  try {
    let game = newPartyGame("quiz", [
      { answer: "同一道题", category: "测试", clues: ["一", "二", "三"] },
    ]);
    for (const id of ids)
      game = partyCommand(
        game,
        { id, name: "玩家" },
        { type: "ready", ready: true },
        10000,
      );
    game = await db.transaction((tx) =>
      syncPartyRewards(
        tx,
        roomId,
        game,
        partyCommand(
          game,
          { id: ids[0]!, name: "玩家" },
          { type: "start" },
          10000,
        ),
      ),
    );
    const policy = await readPointsPolicy();
    await updatePointsPolicy(actor(), {
      ...defaultPointsRules,
      games: {
        ...defaultPointsRules.games,
        "party.quiz": { firstCorrect: 20, painter: 0 },
      },
      version: policy.version,
      dailyCap: 200,
      reason: "验证奖励快照",
    });
    const guest = { id: ids[1]!, name: "玩家" };
    const first = partyCommand(
      game,
      guest,
      { type: "guess", answer: "同一道题" },
      10001,
    );
    await db.transaction((tx) => syncPartyRewards(tx, roomId, game, first));
    expect(
      (await db.transaction((tx) => readPointsSummary(tx, guest.id))).balance,
    ).toBe(10);
    game = await db.transaction((tx) =>
      advancePartyRewards(tx, roomId, first, first.deadline!),
    );
    game = await db.transaction((tx) =>
      advancePartyRewards(tx, roomId, game, game.deadline!),
    );
    const again = partyCommand(
      game,
      guest,
      { type: "guess", answer: "同一道题" },
      60000,
    );
    await db.transaction((tx) => syncPartyRewards(tx, roomId, game, again));
    expect(
      (await db.transaction((tx) => readPointsSummary(tx, guest.id))).balance,
    ).toBe(30);
    const active = await readPointsPolicy();
    await updatePointsPolicy(actor(), {
      ...defaultPointsRules,
      version: active.version,
      enabled: false,
      reason: "验证立即停发",
    });
    const stopped = partyCommand(
      again,
      { id: ids[0]!, name: "玩家" },
      { type: "guess", answer: "同一道题" },
      60001,
    );
    await db.transaction((tx) => syncPartyRewards(tx, roomId, again, stopped));
    const summary = await db.transaction((tx) =>
      readPointsSummary(tx, ids[0]!),
    );
    expect(summary.balance).toBe(0);
    expect(summary.latest?.outcome).toBe("disabled");
  } finally {
    const current = await readPointsPolicy();
    await updatePointsPolicy(actor(), {
      ...defaultPointsRules,
      version: current.version,
      reason: "恢复默认规则",
    });
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  }
});
