import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { PointsRules } from "@cinegather/contracts";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const pointsPolicies = pgTable("points_policies", {
  version: integer("version").primaryKey(),
  rules: jsonb("rules").$type<PointsRules>().notNull(),
  reason: text("reason").notNull(),
  actorId: uuid("actor_id"),
  actorName: text("actor_name").notNull(),
  actorUsername: text("actor_username"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const pointsWallets = pgTable("points_wallets", {
  userId: uuid("user_id").primaryKey(),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  day: text("day").notNull(),
  earned: integer("earned").notNull().default(0),
  sequence: integer("sequence").notNull().default(0),
  headHash: text("head_hash").notNull().default(""),
});
export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    sequence: integer("sequence").notNull(),
    displayName: text("display_name").notNull(),
    username: text("username"),
    roomId: uuid("room_id").notNull(),
    matchId: uuid("match_id").notNull(),
    roundId: uuid("round_id").notNull(),
    game: text("game").notNull(),
    reward: text("reward").notNull(),
    attempt: integer("attempt").notNull(),
    expected: integer("expected").notNull(),
    amount: integer("amount").notNull(),
    before: bigint("balance_before", { mode: "number" }).notNull(),
    after: bigint("balance_after", { mode: "number" }).notNull(),
    day: text("day").notNull(),
    outcome: text("outcome")
      .$type<"awarded" | "capped" | "disabled" | "no_reward">()
      .notNull(),
    appliedCap: integer("applied_cap").notNull(),
    settlementPolicyVersion: integer("settlement_policy_version")
      .notNull()
      .references(() => pointsPolicies.version),
    policyVersion: integer("policy_version")
      .notNull()
      .references(() => pointsPolicies.version),
    facts: jsonb("facts")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    policy: jsonb("policy").$type<PointsRules>().notNull(),
    traceId: uuid("trace_id").notNull(),
    previousHash: text("previous_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
    createdAt: time("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("points_event_unique").on(
      t.userId,
      t.game,
      t.matchId,
      t.roundId,
      t.reward,
    ),
    uniqueIndex("points_sequence_unique").on(t.userId, t.sequence),
    index("points_created_idx").on(t.createdAt),
    index("points_user_day_idx").on(t.userId, t.day),
  ],
);
