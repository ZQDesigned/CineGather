import { z } from "zod";
export const partyAnswerKey = (answer: string) =>
  answer.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export const partyWordInput = z.strictObject({
  answer: z.string().trim().min(1).max(40),
  category: z.string().trim().min(1).max(100),
  categoryId: z.uuid().optional(),
  parentCategory: z.string().trim().min(1).max(40).optional(),
  clues: z.array(z.string().trim().min(1).max(160)).length(3),
  enabled: z.boolean(),
  modes: z
    .array(z.enum(["draw", "quiz"]))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
});
export const partyWordSchema = partyWordInput.extend({
  id: z.uuid(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export const partyWordUpdate = partyWordInput.extend({
  version: z.number().int().min(1),
});
export const partyWordVersion = z.strictObject({
  version: z.number().int().min(1),
});
export const partyBankQuery = z.object({
  q: z.string().trim().max(100).default(""),
  mode: z.enum(["all", "draw", "quiz"]).default("all"),
  status: z.enum(["all", "enabled", "disabled"]).default("all"),
  categoryId: z.uuid().optional(),
  directOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const partyBankSchema = z.object({
  items: z.array(partyWordSchema),
  total: z.number(),
  enabledCount: z.number(),
  allCount: z.number(),
});
export const partyImportInput = z.strictObject({
  format: z.enum(["json", "csv"]),
  content: z.string().min(1).max(200000),
});
export const partyImportPreviewSchema = z.object({
  createCount: z.number(),
  skipCount: z.number(),
  errors: z.array(z.string()),
  sample: z.array(partyWordInput),
});
export const partyImportResultSchema = z.object({
  created: z.number(),
  skipped: z.number(),
});
export type PartyWordInput = z.infer<typeof partyWordInput>;
export type ManagedPartyWord = z.infer<typeof partyWordSchema>;
export type PartyImportInput = z.infer<typeof partyImportInput>;
export type PartyImportPreview = z.infer<typeof partyImportPreviewSchema>;
