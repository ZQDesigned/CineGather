import { wordAuthors } from "./party-authors";
import { randomUUID } from "node:crypto";
import { and, eq, ilike, or, sql, asc, inArray } from "drizzle-orm";
import { partyWordBank, type Transaction } from "@cinegather/database";
import {
  partyAnswerKey,
  type PartyWordInput,
  type PartyImportInput,
  type User,
  type PartyCategory,
  partyCategoryStats,
  partyCategoryPath,
  type partyBankQuery,
} from "@cinegather/contracts";
import type { z } from "zod";
import { db, audit } from "../../core/context";
import { requireManagement } from "../accounts/access";
import { fail, uuid } from "../../core/errors";
import { parsePartyImport } from "./party-bank-import";
import {
  listPartyCatalog,
  resolvePartyCategory,
  lockPartyBank,
  requirePartySelection,
} from "./party-categories";
const shape = (
  r: typeof partyWordBank.$inferSelect,
  categories: PartyCategory[],
  submitter?: { displayName: string; username: string },
) => ({
  ...(submitter ? { submitter } : {}),
  id: r.id,
  answer: r.answer,
  category: r.categoryId
    ? partyCategoryPath(categories, r.categoryId)
    : r.category,
  categoryId: r.categoryId ?? undefined,
  clues: r.clues,
  modes: r.modes,
  enabled: r.enabled,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});
export async function listPartyWords(query: z.infer<typeof partyBankQuery>) {
  const catalog = await listPartyCatalog();
  const categoryIds = query.categoryId
    ? catalog.categories
        .filter(
          (c) =>
            c.id === query.categoryId ||
            (query.directOnly !== "true" && c.parentId === query.categoryId),
        )
        .map((c) => c.id)
    : undefined;
  const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
  const where = and(
    categoryIds
      ? categoryIds.length
        ? inArray(partyWordBank.categoryId, categoryIds)
        : sql`false`
      : undefined,
    query.mode === "all"
      ? undefined
      : sql`${partyWordBank.modes} @> ARRAY[${query.mode}]::text[]`,
    query.q
      ? or(
          ilike(partyWordBank.answer, pattern),
          ilike(partyWordBank.category, pattern),
          inArray(
            partyWordBank.categoryId,
            catalog.categories
              .filter((c) =>
                partyCategoryPath(catalog.categories, c.id)
                  .toLowerCase()
                  .includes(query.q.toLowerCase()),
              )
              .map((c) => c.id),
          ),
        )
      : undefined,
    query.status === "all"
      ? undefined
      : eq(partyWordBank.enabled, query.status === "enabled"),
  );
  const [items, [total], [counts]] = await Promise.all([
    db
      .select()
      .from(partyWordBank)
      .where(where)
      .orderBy(
        asc(partyWordBank.category),
        asc(partyWordBank.answer),
        partyWordBank.id,
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(partyWordBank)
      .where(where),
    db
      .select({
        all: sql<number>`count(*)`.mapWith(Number),
        enabled:
          sql<number>`count(*) filter (where ${partyWordBank.enabled})`.mapWith(
            Number,
          ),
      })
      .from(partyWordBank),
  ]);
  const authors = await wordAuthors(db, items);
  return {
    items: items.map((r) => shape(r, catalog.categories, authors.get(r.id))),
    total: total!.value,
    allCount: counts!.all,
    enabledCount: counts!.enabled,
  };
}
async function lock(tx: Transaction, actor: User) {
  await requireManagement(tx, actor.id, "party-words.manage");
  await lockPartyBank(tx);
}
export async function savePartyWord(
  actor: User,
  input: PartyWordInput,
  id?: string,
  version?: number,
) {
  if (id) id = uuid(id);
  return db.transaction(async (tx) => {
    await lock(tx, actor);
    if (id) {
      const [old] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, id));
      if (!old) fail(404, "PARTY_WORD_NOT_FOUND", "题目不存在");
      if (old.version !== version)
        fail(409, "PARTY_WORD_CHANGED", "题目已被修改，请刷新后重试");
    }
    const answerKey = partyAnswerKey(input.answer);
    const [duplicate] = await tx
      .select({ id: partyWordBank.id })
      .from(partyWordBank)
      .where(eq(partyWordBank.answerKey, answerKey));
    if (duplicate && duplicate.id !== id)
      fail(409, "PARTY_WORD_DUPLICATE", "相同答案的题目已存在");
    const category = await resolvePartyCategory(tx, input);
    const {
      modes,
      categoryId: _id,
      parentCategory: _parent,
      ...fields
    } = input;
    const values = {
      ...fields,
      category: category.name,
      categoryId: category.id,
      ...(modes ? { modes } : {}),
      answerKey,
      updatedAt: new Date(),
    };
    const [row] = id
      ? await tx
          .update(partyWordBank)
          .set({ ...values, version: version! + 1 })
          .where(eq(partyWordBank.id, id))
          .returning()
      : await tx
          .insert(partyWordBank)
          .values({ ...values, id: randomUUID() })
          .returning();
    await audit(
      tx,
      actor.id,
      id ? "admin.party_word_updated" : "admin.party_word_created",
      row!.id,
      {
        answer: input.answer,
        enabled: input.enabled,
        modes: row!.modes,
        categoryId: category.id,
      },
    );
    return shape(
      row!,
      (await listPartyCatalog(tx)).categories,
      (await wordAuthors(tx, [row!])).get(row!.id),
    );
  });
}
export async function deletePartyWord(
  actor: User,
  id: string,
  version: number,
) {
  id = uuid(id);
  return db.transaction(async (tx) => {
    await lock(tx, actor);
    const [old] = await tx
      .select()
      .from(partyWordBank)
      .where(eq(partyWordBank.id, id));
    if (!old) fail(404, "PARTY_WORD_NOT_FOUND", "题目不存在");
    if (old.version !== version)
      fail(409, "PARTY_WORD_CHANGED", "题目已被修改，请刷新后重试");
    await tx.delete(partyWordBank).where(eq(partyWordBank.id, id));
    await audit(tx, actor.id, "admin.party_word_deleted", id, {
      answer: old.answer,
    });
    return { ok: true as const };
  });
}
async function prepare(
  tx: Pick<Transaction, "select">,
  input: PartyImportInput,
) {
  const parsed = parsePartyImport(input);
  const existing = new Set(
    (await tx.select({ key: partyWordBank.answerKey }).from(partyWordBank)).map(
      (r) => r.key,
    ),
  );
  const catalog = await listPartyCatalog(tx);
  const additions = parsed.items.filter(
    (r) => !existing.has(partyAnswerKey(r.answer)),
  );
  for (const item of additions) {
    const index = parsed.items.indexOf(item);
    if (
      item.categoryId &&
      !catalog.categories.some((c) => c.id === item.categoryId)
    )
      parsed.errors.push(`第 ${index + 1} 条：分类 ID 不存在`);
    if (item.parentCategory) {
      const parent = catalog.categories.find(
        (c) => !c.parentId && c.name === item.parentCategory,
      );
      if (
        !parent ||
        !catalog.categories.some(
          (c) => c.parentId === parent.id && c.name === item.category,
        )
      )
        parsed.errors.push(
          `第 ${index + 1} 条：分类路径不存在，请先在分类管理中创建`,
        );
    } else if (
      !item.categoryId &&
      catalog.categories.filter((c) => c.name === item.category).length > 1
    )
      parsed.errors.push(`第 ${index + 1} 条：分类重名，请填写一级分类`);
  }
  return {
    ...parsed,
    additions,
    skipCount: parsed.items.length - additions.length,
  };
}
export async function previewPartyImport(input: PartyImportInput) {
  const r = await prepare(db, input);
  return {
    createCount: r.additions.length,
    skipCount: r.skipCount,
    errors: r.errors,
    sample: r.additions.slice(0, 10),
  };
}
export async function importPartyWords(actor: User, input: PartyImportInput) {
  return db.transaction(async (tx) => {
    await lock(tx, actor);
    const r = await prepare(tx, input);
    if (r.errors.length)
      fail(400, "PARTY_IMPORT_INVALID", r.errors.slice(0, 3).join("；"));
    const additions = [];
    for (const word of r.additions) {
      const category = await resolvePartyCategory(tx, word);
      const { parentCategory: _parent, ...fields } = word;
      additions.push({
        ...fields,
        category: category.name,
        categoryId: category.id,
        id: randomUUID(),
        answerKey: partyAnswerKey(word.answer),
      });
    }
    if (additions.length) await tx.insert(partyWordBank).values(additions);
    await audit(tx, actor.id, "admin.party_words_imported", undefined, {
      created: r.additions.length,
      skipped: r.skipCount,
    });
    return { created: r.additions.length, skipped: r.skipCount };
  });
}
export async function activePartyWords(
  tx: Pick<Transaction, "select">,
  kind: "draw" | "quiz",
  categoryIds: string[] | null = null,
  enforcePolicy = false,
  allowEmpty = false,
) {
  const catalog = await listPartyCatalog(tx);
  const stats = enforcePolicy
    ? requirePartySelection(catalog, categoryIds, kind)
    : partyCategoryStats(catalog.categories, categoryIds, kind);
  const ids = new Set(stats.categoryIds);
  const rows = await tx
    .select()
    .from(partyWordBank)
    .where(
      and(
        eq(partyWordBank.enabled, true),
        sql`${partyWordBank.modes} @> ARRAY[${kind}]::text[]`,
      ),
    );
  const authors = await wordAuthors(tx, rows);
  const filtered = rows
    .filter((r) =>
      ids.has(
        r.categoryId ??
          catalog.categories.find((c) => c.name === r.category)?.id ??
          "",
      ),
    )
    .map((r) => ({
      answer: r.answer,
      category: r.categoryId
        ? partyCategoryPath(catalog.categories, r.categoryId)
        : r.category,
      clues: r.clues,
      ...(authors.has(r.id)
        ? { author: { displayName: authors.get(r.id)!.displayName } }
        : {}),
    }));
  if (!allowEmpty && filtered.length < 3)
    fail(
      409,
      "PARTY_BANK_UNAVAILABLE",
      `${kind === "draw" ? "绘画" : "猜词"}启用题目不足 3 道，请联系管理员补充题库`,
    );
  return filtered;
}
