import { eq, sql } from "drizzle-orm";
import {
  users,
  partyFirstCorrect,
  type Transaction,
} from "@cinegather/database";
import {
  partyAnswerKey,
  submissionEligibility,
  type User,
} from "@cinegather/contracts";
import { db } from "../../core/context";
import { fail } from "../../core/errors";

export async function recordFirstCorrect(
  tx: Transaction,
  userId: string,
  answer: string,
) {
  await tx
    .insert(partyFirstCorrect)
    .values({ userId, answerKey: partyAnswerKey(answer) })
    .onConflictDoNothing();
}
export async function readSubmissionEligibility(
  user: User,
  tx: Pick<Transaction, "select"> = db,
) {
  const [account] = await tx.select().from(users).where(eq(users.id, user.id));
  if (!account?.username || account.disabledAt)
    fail(403, "ACCOUNT_REQUIRED", "请使用有效账号登录");
  const [stats] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(partyFirstCorrect)
    .where(eq(partyFirstCorrect.userId, user.id));
  return submissionEligibility(account.createdAt, stats!.count);
}
