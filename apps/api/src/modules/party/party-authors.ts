import { inArray } from "drizzle-orm";
import {
  users,
  type Transaction,
  type partyWordBank,
} from "@cinegather/database";
import type { z } from "zod";
import type { partySubmitterSchema } from "@cinegather/contracts";
/** Only management responses use username; game snapshots explicitly select displayName. */
export async function wordAuthors(
  tx: Pick<Transaction, "select">,
  words: (typeof partyWordBank.$inferSelect)[],
) {
  const ids = [
    ...new Set(words.flatMap((w) => (w.authorUserId ? [w.authorUserId] : []))),
  ];
  const accounts = ids.length
    ? await tx
        .select({
          id: users.id,
          displayName: users.displayName,
          username: users.username,
        })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const authors = new Map<string, z.infer<typeof partySubmitterSchema>>();
  for (const w of words) {
    if (!w.authorDisplayNameSnapshot) continue;
    const account = w.authorUserId ? byId.get(w.authorUserId) : undefined;
    authors.set(w.id, {
      displayName: account?.displayName ?? w.authorDisplayNameSnapshot,
      username: account?.username ?? w.authorUsernameSnapshot ?? "",
    });
  }
  return authors;
}
