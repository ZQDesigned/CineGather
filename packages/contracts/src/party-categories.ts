import { z } from "zod";
export const partyCategoryInput = z.strictObject({
  name: z.string().trim().min(1).max(40),
  parentId: z.uuid().nullable(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
});
export const partyCategoryUpdate = partyCategoryInput.extend({
  version: z.number().int().positive(),
});
export const partyCategorySchema = partyCategoryInput.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  drawCount: z.number().int().nonnegative(),
  quizCount: z.number().int().nonnegative(),
});
const limits = (minimum: number) =>
  z.strictObject({
    minQuestions: z.number().int().min(minimum).max(10000),
    minCategories: z.number().int().min(0).max(500),
  });
export const partyPolicyInput = z.strictObject({
  version: z.number().int().positive(),
  draw: limits(6),
  quiz: limits(3),
});
export const partyCatalogSchema = z.object({
  categories: z.array(partyCategorySchema),
  policy: partyPolicyInput,
});
export const partyCategoryIds = z
  .array(z.uuid())
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, "分类不能重复");
export const partyBulkMoveInput = z.strictObject({
  categoryId: z.uuid(),
  items: z
    .array(
      z.strictObject({ id: z.uuid(), version: z.number().int().positive() }),
    )
    .min(1)
    .max(500)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length),
});
export type PartyCategory = z.infer<typeof partyCategorySchema>;
export type PartyCatalog = z.infer<typeof partyCatalogSchema>;
export type PartyPolicy = z.infer<typeof partyPolicyInput>;
export type PartyMode = "draw" | "quiz";
export function partyCategoryStats(
  categories: PartyCategory[],
  ids: string[] | null,
  mode: PartyMode,
) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const selected = ids === null ? null : new Set(ids);
  const valid = categories.filter(
    (c) =>
      (!selected || selected.has(c.id)) &&
      c.enabled &&
      (!c.parentId ||
        (byId.get(c.parentId)?.enabled && !byId.get(c.parentId)?.parentId)) &&
      (mode === "draw" ? c.drawCount : c.quizCount) > 0,
  );
  return {
    questionCount: valid.reduce(
      (n, c) => n + (mode === "draw" ? c.drawCount : c.quizCount),
      0,
    ),
    categoryCount: valid.length,
    categoryIds: valid.map((c) => c.id),
  };
}
export function partyCategoryPath(categories: PartyCategory[], id: string) {
  const c = categories.find((c) => c.id === id);
  if (!c) return "分类已移除";
  const parent = categories.find((p) => p.id === c.parentId);
  return parent ? `${parent.name} / ${c.name}` : c.name;
}
export function partyCategoryBranches(categories: PartyCategory[], id: string) {
  return categories
    .filter((c) => c.id === id || c.parentId === id)
    .map((c) => c.id);
}
