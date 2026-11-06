import { randomUUID } from "node:crypto";
import { and, eq, ilike, or, sql, asc } from "drizzle-orm";
import { partyWordBank, type Transaction } from "@cinegather/database";
import {
  partyAnswerKey,
  type PartyWordInput,
  type PartyImportInput,
  type User,
  type partyBankQuery,
} from "@cinegather/contracts";
import type { z } from "zod";
import { db, audit } from "./context";
import { requireManagement } from "./access";
import { fail, uuid } from "./errors";
import { parsePartyImport } from "./party-bank-import";
const bankLock = 839231;
const shape = (r: typeof partyWordBank.$inferSelect) => ({
  id: r.id,
  answer: r.answer,
  category: r.category,
  clues: r.clues,
  enabled: r.enabled,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});
export async function listPartyWords(query: z.infer<typeof partyBankQuery>) {
  const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
  const where = and(
    query.q
      ? or(
          ilike(partyWordBank.answer, pattern),
          ilike(partyWordBank.category, pattern),
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
  return {
    items: items.map(shape),
    total: total!.value,
    allCount: counts!.all,
    enabledCount: counts!.enabled,
  };
}
async function lock(tx: Transaction, actor: User) {
  await requireManagement(tx, actor.id, "party-words.manage");
  await tx.execute(sql`select pg_advisory_xact_lock(${bankLock})`);
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
    const values = { ...input, answerKey, updatedAt: new Date() };
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
      { answer: input.answer, enabled: input.enabled },
    );
    return shape(row!);
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
  const additions = parsed.items.filter(
    (r) => !existing.has(partyAnswerKey(r.answer)),
  );
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
    if (r.additions.length)
      await tx
        .insert(partyWordBank)
        .values(
          r.additions.map((word) => ({
            ...word,
            id: randomUUID(),
            answerKey: partyAnswerKey(word.answer),
          })),
        );
    await audit(tx, actor.id, "admin.party_words_imported", undefined, {
      created: r.additions.length,
      skipped: r.skipCount,
    });
    return { created: r.additions.length, skipped: r.skipCount };
  });
}
export async function activePartyWords(tx: Pick<Transaction, "select">) {
  const rows = await tx
    .select({
      answer: partyWordBank.answer,
      category: partyWordBank.category,
      clues: partyWordBank.clues,
    })
    .from(partyWordBank)
    .where(eq(partyWordBank.enabled, true));
  if (rows.length < 3)
    fail(
      409,
      "PARTY_BANK_UNAVAILABLE",
      "启用的题目不足 3 道，请联系管理员补充题库",
    );
  return rows;
}
