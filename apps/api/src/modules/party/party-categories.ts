import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  partyCategories,
  partyWordBank,
  partyBankPolicy,
  type Transaction,
} from "@cinegather/database";
import {
  partyCategoryStats,
  partyCategoryPath,
  type PartyCatalog,
  type PartyMode,
  type User,
  type partyCategoryInput,
  type partyBulkMoveInput,
  type PartyPolicy,
} from "@cinegather/contracts";
import type { z } from "zod";
import { db, audit } from "../../core/context";
import { fail, uuid } from "../../core/errors";
import { requireManagement } from "../accounts/access";
export const categoryNameKey = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export async function lockPartyBank(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(839231)`);
}
export async function listPartyCatalog(
  tx: Pick<Transaction, "select"> = db,
): Promise<PartyCatalog> {
  const categories = await tx
    .select()
    .from(partyCategories)
    .orderBy(
      partyCategories.sortOrder,
      partyCategories.name,
      partyCategories.id,
    );
  const words = await tx
    .select({
      categoryId: partyWordBank.categoryId,
      category: partyWordBank.category,
      modes: partyWordBank.modes,
    })
    .from(partyWordBank)
    .where(eq(partyWordBank.enabled, true));
  const counts = new Map<string, { drawCount: number; quizCount: number }>();
  for (const w of words) {
    const id =
      w.categoryId ?? categories.find((c) => c.name === w.category)?.id;
    if (!id) continue;
    const count = counts.get(id) ?? { drawCount: 0, quizCount: 0 };
    if (w.modes.includes("draw")) count.drawCount++;
    if (w.modes.includes("quiz")) count.quizCount++;
    counts.set(id, count);
  }
  const [p] = await tx
    .select()
    .from(partyBankPolicy)
    .where(eq(partyBankPolicy.id, 1));
  return {
    categories: categories.map(({ nameKey: _key, ...c }) => ({
      ...c,
      ...(counts.get(c.id) ?? { drawCount: 0, quizCount: 0 }),
    })),
    policy: {
      version: p!.version,
      draw: {
        minQuestions: p!.drawMinQuestions,
        minCategories: p!.drawMinCategories,
      },
      quiz: {
        minQuestions: p!.quizMinQuestions,
        minCategories: p!.quizMinCategories,
      },
    },
  };
}
async function manage(tx: Transaction, actor: User) {
  await requireManagement(tx, actor.id, "party-words.manage");
  await lockPartyBank(tx);
}
export async function savePartyCategory(
  actor: User,
  input: z.infer<typeof partyCategoryInput>,
  id?: string,
  version?: number,
) {
  if (id) id = uuid(id);
  return db.transaction(async (tx) => {
    await manage(tx, actor);
    const all = await tx.select().from(partyCategories),
      old = all.find((c) => c.id === id);
    if (id && !old) fail(404, "PARTY_CATEGORY_NOT_FOUND", "分类不存在");
    if (old && old.version !== version)
      fail(409, "PARTY_CATEGORY_CHANGED", "分类已修改，请刷新后重试");
    const parent = all.find((c) => c.id === input.parentId);
    if (
      input.parentId &&
      (!parent ||
        parent.parentId ||
        input.parentId === id ||
        all.some((c) => c.parentId === id))
    )
      fail(409, "PARTY_CATEGORY_DEPTH", "只支持两级分类，请先移动下属分类");
    const nameKey = categoryNameKey(input.name);
    if (
      all.some(
        (c) =>
          c.id !== id &&
          c.parentId === input.parentId &&
          categoryNameKey(c.name) === nameKey,
      )
    )
      fail(409, "PARTY_CATEGORY_DUPLICATE", "同级分类名称已存在");
    if (!old && all.length >= 500)
      fail(409, "PARTY_CATEGORY_LIMIT", "分类最多 500 个");
    const values = { ...input, nameKey };
    const [saved] = old
      ? await tx
          .update(partyCategories)
          .set({ ...values, version: old.version + 1 })
          .where(eq(partyCategories.id, id!))
          .returning()
      : await tx
          .insert(partyCategories)
          .values({ ...values, id: randomUUID() })
          .returning();
    await audit(
      tx,
      actor.id,
      old ? "admin.party_category_updated" : "admin.party_category_created",
      saved!.id,
      { name: input.name, parentId: input.parentId, enabled: input.enabled },
    );
    const catalog = await listPartyCatalog(tx);
    return catalog.categories.find((c) => c.id === saved!.id)!;
  });
}
export async function deletePartyCategory(
  actor: User,
  id: string,
  version: number,
) {
  id = uuid(id);
  return db.transaction(async (tx) => {
    await manage(tx, actor);
    const [c] = await tx
      .select()
      .from(partyCategories)
      .where(eq(partyCategories.id, id));
    if (!c) fail(404, "PARTY_CATEGORY_NOT_FOUND", "分类不存在");
    if (c.version !== version)
      fail(409, "PARTY_CATEGORY_CHANGED", "分类已修改，请刷新后重试");
    const children = await tx
      .select({ id: partyCategories.id })
      .from(partyCategories)
      .where(eq(partyCategories.parentId, id));
    const words = await tx
      .select({ id: partyWordBank.id })
      .from(partyWordBank)
      .where(
        sql`${partyWordBank.categoryId}=${id} OR (${partyWordBank.categoryId} IS NULL AND ${partyWordBank.category}=${c.name})`,
      )
      .limit(1);
    if (children.length || words.length)
      fail(409, "PARTY_CATEGORY_NOT_EMPTY", "请先移走该分类的题目和子分类");
    await tx.delete(partyCategories).where(eq(partyCategories.id, id));
    await audit(tx, actor.id, "admin.party_category_deleted", id, {
      name: c.name,
    });
    return { ok: true as const };
  });
}
export async function savePartyPolicy(actor: User, input: PartyPolicy) {
  return db.transaction(async (tx) => {
    await manage(tx, actor);
    const [old] = await tx
      .select()
      .from(partyBankPolicy)
      .where(eq(partyBankPolicy.id, 1));
    if (old!.version !== input.version)
      fail(409, "PARTY_POLICY_CHANGED", "开局规则已修改，请刷新后重试");
    await tx
      .update(partyBankPolicy)
      .set({
        version: input.version + 1,
        drawMinQuestions: input.draw.minQuestions,
        drawMinCategories: input.draw.minCategories,
        quizMinQuestions: input.quiz.minQuestions,
        quizMinCategories: input.quiz.minCategories,
      })
      .where(eq(partyBankPolicy.id, 1));
    await audit(tx, actor.id, "admin.party_policy_updated", undefined, {
      draw: input.draw,
      quiz: input.quiz,
    });
    return { ...input, version: input.version + 1 };
  });
}
// Legacy single-category inputs may create a root; new path/ID inputs must resolve exactly.
export async function resolvePartyCategory(
  tx: Transaction,
  input: { category: string; categoryId?: string; parentCategory?: string },
) {
  const all = await tx.select().from(partyCategories);
  if (input.categoryId) {
    const c = all.find((c) => c.id === input.categoryId);
    if (!c) fail(409, "PARTY_CATEGORY_NOT_FOUND", "分类不存在，请重新选择");
    return c;
  }
  const parent = input.parentCategory
    ? all.find(
        (c) =>
          !c.parentId &&
          categoryNameKey(c.name) === categoryNameKey(input.parentCategory!),
      )
    : undefined;
  if (input.parentCategory && !parent)
    fail(400, "PARTY_CATEGORY_NOT_FOUND", "一级分类不存在");
  const matches = all.filter(
    (c) =>
      categoryNameKey(c.name) === categoryNameKey(input.category) &&
      (!input.parentCategory || c.parentId === parent!.id),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    fail(400, "PARTY_CATEGORY_AMBIGUOUS", "分类重名，请指定一级分类或分类 ID");
  if (input.parentCategory)
    fail(400, "PARTY_CATEGORY_NOT_FOUND", "二级分类不存在");
  if (input.category.length > 40)
    fail(400, "PARTY_CATEGORY_NAME", "一级分类名称不能超过 40 个字");
  if (all.length >= 500) fail(409, "PARTY_CATEGORY_LIMIT", "分类最多 500 个");
  const [c] = await tx
    .insert(partyCategories)
    .values({
      id: randomUUID(),
      name: input.category,
      nameKey: categoryNameKey(input.category),
    })
    .returning();
  return c!;
}
export async function movePartyWords(
  actor: User,
  input: z.infer<typeof partyBulkMoveInput>,
) {
  return db.transaction(async (tx) => {
    await manage(tx, actor);
    const [category] = await tx
      .select()
      .from(partyCategories)
      .where(eq(partyCategories.id, input.categoryId));
    if (!category) fail(404, "PARTY_CATEGORY_NOT_FOUND", "分类不存在");
    const rows = await tx
      .select()
      .from(partyWordBank)
      .where(
        inArray(
          partyWordBank.id,
          input.items.map((i) => i.id),
        ),
      );
    if (
      input.items.some(
        (i) => !rows.some((r) => r.id === i.id && r.version === i.version),
      )
    )
      fail(409, "PARTY_WORD_CHANGED", "有题目已被修改或删除，请刷新后重试");
    await tx
      .update(partyWordBank)
      .set({
        categoryId: category.id,
        category: category.name,
        version: sql`${partyWordBank.version}+1`,
        updatedAt: new Date(),
      })
      .where(
        inArray(
          partyWordBank.id,
          rows.map((r) => r.id),
        ),
      );
    await audit(tx, actor.id, "admin.party_words_moved", category.id, {
      items: input.items,
    });
    return { ok: true as const };
  });
}
export function requirePartySelection(
  catalog: PartyCatalog,
  ids: string[] | null,
  mode: PartyMode,
) {
  const stats = partyCategoryStats(catalog.categories, ids, mode),
    rule = catalog.policy[mode];
  if (ids && ids.some((id) => !stats.categoryIds.includes(id)))
    fail(
      409,
      "PARTY_CATEGORIES_CHANGED",
      "部分分类已停用、移除或没有当前玩法的题目，请重新选择",
    );
  if (
    stats.questionCount < rule.minQuestions ||
    stats.categoryCount < rule.minCategories
  )
    fail(
      409,
      "PARTY_SELECTION_INSUFFICIENT",
      `所选分类有 ${stats.questionCount} 道题、${stats.categoryCount} 个有效分类；至少需要 ${rule.minQuestions} 道题${rule.minCategories ? `、${rule.minCategories} 个分类` : ""}`,
    );
  return stats;
}
export { partyCategoryPath };
