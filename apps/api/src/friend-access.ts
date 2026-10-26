import { friendships, users, type Transaction } from "@cinegather/database";
import { and, eq, isNull, isNotNull, or, sql } from "drizzle-orm";

export async function areAcceptedFriends(
  tx: Transaction,
  userId: string,
  targetId: string,
) {
  const [friend] = await tx
    .select({ userId: users.id })
    .from(friendships)
    .innerJoin(users, eq(users.id, targetId))
    .where(
      and(
        eq(friendships.status, "accepted"),
        isNull(users.disabledAt),
        isNotNull(users.username),
        sql`EXISTS (SELECT 1 FROM users AS sender WHERE sender.id = ${userId} AND sender.disabled_at IS NULL AND sender.username IS NOT NULL)`,
        or(
          and(
            eq(friendships.requesterId, userId),
            eq(friendships.recipientId, targetId),
          ),
          and(
            eq(friendships.requesterId, targetId),
            eq(friendships.recipientId, userId),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(friend);
}
