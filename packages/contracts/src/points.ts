import { z } from "zod";

export const POINTS_FEATURE = "account-points-v1";
export const pointsGameSchema = z.enum(["party.draw", "party.quiz"]);
export type PointsGame = z.infer<typeof pointsGameSchema>;
export const pointsGameNames: Record<PointsGame, string> = {
  "party.draw": "你画我猜",
  "party.quiz": "猜词抢答",
};
const reward = z.strictObject({
  firstCorrect: z.number().int().min(0).max(1000).multipleOf(2),
  painter: z.number().int().min(0).max(1000),
});
export const pointsRulesSchema = z.strictObject({
  enabled: z.boolean(),
  dailyCap: z.number().int().min(0).max(100000),
  games: z.strictObject({
    "party.draw": reward,
    "party.quiz": reward.extend({ painter: z.literal(0) }),
  }),
});
export type PointsRules = z.infer<typeof pointsRulesSchema>;
export const defaultPointsRules: PointsRules = {
  enabled: true,
  dailyCap: 100,
  games: {
    "party.draw": { firstCorrect: 10, painter: 5 },
    "party.quiz": { firstCorrect: 10, painter: 0 },
  },
};
export const publicPointsPolicySchema = pointsRulesSchema.extend({
  version: z.number().int().positive(),
});
export type PublicPointsPolicy = z.infer<typeof publicPointsPolicySchema>;
export const pointsPolicySchema = pointsRulesSchema.extend({
  version: z.number().int().positive(),
  reason: z.string(),
  actorName: z.string(),
  actorUsername: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PointsPolicy = z.infer<typeof pointsPolicySchema>;
export const pointsPolicyInput = pointsRulesSchema.extend({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(300),
});
export const pointsEntrySchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  game: z.string().min(1).max(80),
  reward: z.string().min(1).max(80),
  amount: z.number().int().nonnegative(),
  expected: z.number().int().nonnegative(),
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
  outcome: z.enum(["awarded", "capped", "disabled", "no_reward"]),
  attempt: z.number().int().nonnegative(),
  day: z.string(),
  createdAt: z.iso.datetime(),
  policyVersion: z.number().int().positive(),
});
export type PointsEntry = z.infer<typeof pointsEntrySchema>;
export const adminPointsEntrySchema = pointsEntrySchema.extend({
  userId: z.uuid(),
  displayName: z.string(),
  username: z.string().nullable(),
  roomId: z.uuid(),
  matchId: z.uuid(),
  roundId: z.uuid(),
  traceId: z.uuid(),
  appliedCap: z.number().int().nonnegative(),
  settlementPolicyVersion: z.number().int().positive(),
  facts: z.record(z.string(), z.unknown()),
  policy: pointsRulesSchema,
  previousHash: z.string(),
  entryHash: z.string(),
});
export type AdminPointsEntry = z.infer<typeof adminPointsEntrySchema>;
export const pointsSummarySchema = z.object({
  balance: z.number().int().nonnegative(),
  todayEarned: z.number().int().nonnegative(),
  dailyCap: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  day: z.string(),
  enabled: z.boolean(),
  latest: pointsEntrySchema.nullable(),
});
export type PointsSummary = z.infer<typeof pointsSummarySchema>;
export const pointsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  game: pointsGameSchema.optional(),
  today: z.enum(["true", "false"]).default("false"),
  q: z.string().trim().max(100).default(""),
});
export const pointsListSchema = z.object({
  items: z.array(pointsEntrySchema),
  total: z.number().int().nonnegative(),
});
export const adminPointsListSchema = z.object({
  items: z.array(adminPointsEntrySchema),
  total: z.number().int().nonnegative(),
});
export const pointsPoliciesSchema = z.object({
  items: z.array(pointsPolicySchema),
  total: z.number().int().nonnegative(),
});
