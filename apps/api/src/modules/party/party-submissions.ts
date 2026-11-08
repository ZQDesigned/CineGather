import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import {
  partySubmissions,
  partyWordBank,
  users,
  type Transaction,
} from "@cinegather/database";
import {
  partyAnswerKey,
  partyCategoryPath,
  partySubmissionDraft,
  type PartySubmissionDraft,
  type PartySubmission,
  type User,
  type partySubmissionQuery,
  type partySubmissionReview,
} from "@cinegather/contracts";
import type { z } from "zod";
import { db, audit } from "../../core/context";
import { fail, uuid } from "../../core/errors";
import { requireManagement } from "../accounts/access";
import { listPartyCatalog, lockPartyBank } from "./party-categories";
import { readSubmissionEligibility } from "./party-learning";

type Row = typeof partySubmissions.$inferSelect;
async function shaped(
  tx: Pick<Transaction, "select">,
  rows: Row[],
): Promise<PartySubmission[]> {
  const catalog = await listPartyCatalog(tx);
  const ids = [
    ...new Set(
      rows.flatMap((r) =>
        [r.userId, r.reviewerId].filter((id): id is string => !!id),
      ),
    ),
  ];
  const accounts = ids.length
    ? await tx
        .select({
          id: users.id,
          name: users.displayName,
          username: users.username,
        })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((row) => {
    const identity = row.userId ? byId.get(row.userId) : undefined;
    const handled = row.reviewerId ? byId.get(row.reviewerId) : undefined;
    const draft = partySubmissionDraft.parse(row.draft),
      reviewedDraft =
        row.reviewedDraft == null
          ? null
          : partySubmissionDraft.parse(row.reviewedDraft);
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      draft,
      reviewedDraft,
      author: {
        displayName: identity?.name ?? row.displayNameSnapshot,
        username: identity?.username ?? row.usernameSnapshot,
      },
      categoryPath: partyCategoryPath(catalog.categories, draft.categoryId),
      reviewedCategoryPath: reviewedDraft
        ? partyCategoryPath(catalog.categories, reviewedDraft.categoryId)
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      wordId: row.wordId,
      reason: row.reason,
      reviewerName: handled?.name ?? null,
    };
  });
}
async function ownRow(
  tx: Transaction,
  user: User,
  id: string,
  version?: number,
) {
  const [row] = await tx
    .select()
    .from(partySubmissions)
    .where(
      and(
        eq(partySubmissions.id, uuid(id)),
        eq(partySubmissions.userId, user.id),
      ),
    )
    .for("update");
  if (!row) fail(404, "SUBMISSION_NOT_FOUND", "投稿不存在");
  if (version !== undefined && row.version !== version)
    fail(409, "SUBMISSION_CHANGED", "投稿已更新，请刷新后重试");
  return row;
}
async function validate(
  tx: Transaction,
  draft: PartySubmissionDraft,
  id?: string,
) {
  const catalog = await listPartyCatalog(tx),
    category = catalog.categories.find((c) => c.id === draft.categoryId),
    parent = category?.parentId
      ? catalog.categories.find((c) => c.id === category.parentId)
      : undefined;
  if (!category?.enabled || (category.parentId && !parent?.enabled))
    fail(
      409,
      "SUBMISSION_CATEGORY_UNAVAILABLE",
      "分类已停用或移除，请重新选择",
    );
  const key = partyAnswerKey(draft.answer);
  const [duplicate] = await tx
    .select({ id: partyWordBank.id })
    .from(partyWordBank)
    .where(eq(partyWordBank.answerKey, key));
  if (duplicate) fail(409, "PARTY_WORD_DUPLICATE", "相同答案的题目已存在");
  const [pending] = await tx
    .select({ id: partySubmissions.id })
    .from(partySubmissions)
    .where(
      and(
        eq(partySubmissions.answerKey, key),
        eq(partySubmissions.status, "pending"),
        id ? ne(partySubmissions.id, id) : undefined,
      ),
    );
  if (pending) fail(409, "SUBMISSION_DUPLICATE", "相同答案的投稿正在审核中");
  return { category, key };
}
export async function listSubmissions(
  user: User,
  query: z.infer<typeof partySubmissionQuery>,
  admin = false,
) {
  return db.transaction(async (tx) => {
    if (admin) await requireManagement(tx, user.id, "party-submissions.read");
    const scope = admin ? undefined : eq(partySubmissions.userId, user.id),
      pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    const where = and(
      scope,
      query.status === "all"
        ? undefined
        : eq(partySubmissions.status, query.status),
      query.q
        ? or(
            sql`${partySubmissions.draft}->>'answer' ilike ${pattern}`,
            ilike(partySubmissions.displayNameSnapshot, pattern),
            ilike(partySubmissions.usernameSnapshot, pattern),
            ilike(users.displayName, pattern),
            ilike(users.username, pattern),
          )
        : undefined,
    );
    const [rows, [total], [pending]] = await Promise.all([
      tx
        .select({ row: partySubmissions })
        .from(partySubmissions)
        .leftJoin(users, eq(users.id, partySubmissions.userId))
        .where(where)
        .orderBy(desc(partySubmissions.createdAt), partySubmissions.id)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(partySubmissions)
        .leftJoin(users, eq(users.id, partySubmissions.userId))
        .where(where),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(partySubmissions)
        .where(and(scope, eq(partySubmissions.status, "pending"))),
    ]);
    return {
      items: await shaped(
        tx,
        rows.map((r) => r.row),
      ),
      total: total!.count,
      pendingCount: pending!.count,
    };
  });
}
export async function readSubmission(user: User, id: string, admin = false) {
  return db.transaction(async (tx) => {
    if (admin) await requireManagement(tx, user.id, "party-submissions.read");
    const [row] = await tx
      .select()
      .from(partySubmissions)
      .where(
        and(
          eq(partySubmissions.id, uuid(id)),
          admin ? undefined : eq(partySubmissions.userId, user.id),
        ),
      );
    if (!row) fail(404, "SUBMISSION_NOT_FOUND", "投稿不存在");
    return (await shaped(tx, [row]))[0]!;
  });
}
export async function saveSubmission(
  user: User,
  draft: PartySubmissionDraft,
  id?: string,
  version?: number,
) {
  return db.transaction(async (tx) => {
    const eligibility = await readSubmissionEligibility(user, tx);
    if (!eligibility.eligible)
      fail(
        403,
        "SUBMISSION_NOT_ELIGIBLE",
        "注册超过 7 天且首次答对 50 道不同题目后可投稿",
      );
    await lockPartyBank(tx);
    const old = id ? await ownRow(tx, user, id, version) : undefined;
    if (old?.status === "approved")
      fail(409, "SUBMISSION_REVIEWED", "已收录投稿不能修改，请联系审核员");
    const { key } = await validate(tx, draft, id);
    const [account] = await tx
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    const values = {
      draft,
      answerKey: key,
      status: "pending" as const,
      reviewedDraft: null,
      reviewerId: null,
      reviewedAt: null,
      reason: null,
      wordId: null,
      updatedAt: new Date(),
      displayNameSnapshot: account!.displayName,
      usernameSnapshot: account!.username!,
    };
    const [row] = old
      ? await tx
          .update(partySubmissions)
          .set({ ...values, version: old.version + 1 })
          .where(eq(partySubmissions.id, old.id))
          .returning()
      : await tx
          .insert(partySubmissions)
          .values({ ...values, id: randomUUID(), userId: user.id })
          .returning();
    await audit(
      tx,
      user.id,
      old ? "party.submission_updated" : "party.submission_created",
      row!.id,
      { before: old?.draft, after: draft, version: row!.version },
    );
    return (await shaped(tx, [row!]))[0]!;
  });
}
export async function withdrawSubmission(
  user: User,
  id: string,
  version: number,
) {
  return db.transaction(async (tx) => {
    await lockPartyBank(tx);
    const old = await ownRow(tx, user, id, version);
    if (old.status !== "pending")
      fail(409, "SUBMISSION_REVIEWED", "当前投稿无法撤回，请刷新后重试");
    const [row] = await tx
      .update(partySubmissions)
      .set({
        status: "withdrawn",
        version: old.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(partySubmissions.id, old.id))
      .returning();
    await audit(tx, user.id, "party.submission_withdrawn", old.id, {
      version: row!.version,
    });
    return (await shaped(tx, [row!]))[0]!;
  });
}
export async function reviewSubmission(
  user: User,
  id: string,
  input: z.infer<typeof partySubmissionReview>,
) {
  return db.transaction(async (tx) => {
    await requireManagement(tx, user.id, "party-submissions.review");
    await lockPartyBank(tx);
    const [old] = await tx
      .select()
      .from(partySubmissions)
      .where(eq(partySubmissions.id, uuid(id)))
      .for("update");
    if (!old) fail(404, "SUBMISSION_NOT_FOUND", "投稿不存在");
    if (old.version !== input.version || old.status !== "pending")
      fail(409, "SUBMISSION_CHANGED", "投稿已更新或处理，请刷新后重试");
    let wordId: string | null = null,
      reviewedDraft: PartySubmissionDraft | null = null;
    if (input.decision === "approve") {
      reviewedDraft = input.draft ?? partySubmissionDraft.parse(old.draft);
      const { category, key } = await validate(tx, reviewedDraft, old.id);
      const [author] = old.userId
        ? await tx.select().from(users).where(eq(users.id, old.userId))
        : [];
      wordId = randomUUID();
      await tx.insert(partyWordBank).values({
        id: wordId,
        answer: reviewedDraft.answer,
        answerKey: key,
        categoryId: category.id,
        category: category.name,
        clues: reviewedDraft.clues,
        modes: reviewedDraft.modes,
        enabled: true,
        authorUserId: old.userId,
        authorDisplayNameSnapshot:
          author?.displayName ?? old.displayNameSnapshot,
        authorUsernameSnapshot: author?.username ?? old.usernameSnapshot,
      });
    }
    const [row] = await tx
      .update(partySubmissions)
      .set({
        status: input.decision === "approve" ? "approved" : "rejected",
        reviewedDraft,
        wordId,
        reviewerId: user.id,
        reason: input.decision === "reject" ? input.reason : null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
        version: old.version + 1,
      })
      .where(eq(partySubmissions.id, old.id))
      .returning();
    await audit(
      tx,
      user.id,
      input.decision === "approve"
        ? "admin.party_submission_approved"
        : "admin.party_submission_rejected",
      old.id,
      {
        original: old.draft,
        reviewedDraft,
        wordId,
        reason: row!.reason,
        authorName: old.displayNameSnapshot,
        authorUsername: old.usernameSnapshot,
      },
    );
    return (await shaped(tx, [row!]))[0]!;
  });
}
