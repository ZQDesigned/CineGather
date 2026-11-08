import { z } from "zod";
export const PARTY_SUBMISSIONS_FEATURE = "party-submissions-v1";

export const partyWordAuthorSchema = z.object({ displayName: z.string() });
export type PartyWordAuthor = z.infer<typeof partyWordAuthorSchema>;
export const partySubmitterSchema = partyWordAuthorSchema.extend({
  username: z.string(),
});
export const submissionEligibilitySchema = z.object({
  registeredAt: z.string(),
  serverTime: z.number(),
  registrationRequiredDays: z.literal(7),
  requiredCorrect: z.literal(50),
  firstTryCorrect: z.number().int().nonnegative(),
  ageEligible: z.boolean(),
  eligible: z.boolean(),
});
export type SubmissionEligibility = z.infer<typeof submissionEligibilitySchema>;
export function submissionEligibility(
  registeredAt: Date,
  firstTryCorrect: number,
  now = Date.now(),
): SubmissionEligibility {
  const ageEligible = now - registeredAt.getTime() > 7 * 86_400_000;
  return {
    registeredAt: registeredAt.toISOString(),
    serverTime: now,
    registrationRequiredDays: 7,
    requiredCorrect: 50,
    firstTryCorrect,
    ageEligible,
    eligible: ageEligible && firstTryCorrect >= 50,
  };
}
export const partySubmissionDraft = z.strictObject({
  answer: z.string().trim().min(1).max(40),
  categoryId: z.uuid(),
  clues: z.array(z.string().trim().min(1).max(160)).length(3),
  modes: z
    .array(z.enum(["draw", "quiz"]))
    .min(1)
    .max(2)
    .refine((a) => new Set(a).size === a.length, "玩法不能重复"),
});
export type PartySubmissionDraft = z.infer<typeof partySubmissionDraft>;
export const partySubmissionVersion = z.strictObject({
  version: z.number().int().positive(),
});
export const partySubmissionUpdate = partySubmissionDraft.extend(
  partySubmissionVersion.shape,
);
export const partySubmissionStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);
export const partySubmissionQuery = z.object({
  status: z.enum(["all", ...partySubmissionStatus.options]).default("all"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export const partySubmissionReview = z.discriminatedUnion("decision", [
  z.strictObject({
    version: z.number().int().positive(),
    decision: z.literal("approve"),
    draft: partySubmissionDraft.optional(),
  }),
  z.strictObject({
    version: z.number().int().positive(),
    decision: z.literal("reject"),
    reason: z.string().trim().min(2).max(200),
  }),
]);
export const partySubmissionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: partySubmissionStatus,
  draft: partySubmissionDraft,
  reviewedDraft: partySubmissionDraft.nullable(),
  author: partySubmitterSchema,
  categoryPath: z.string(),
  reviewedCategoryPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reviewedAt: z.string().nullable(),
  reason: z.string().nullable(),
  wordId: z.uuid().nullable(),
  reviewerName: z.string().nullable(),
});
export type PartySubmission = z.infer<typeof partySubmissionSchema>;
export const partySubmissionsSchema = z.object({
  items: z.array(partySubmissionSchema),
  total: z.number(),
  pendingCount: z.number(),
});
