import { parseArgs } from "node:util";
import { gt } from "drizzle-orm";
import { pointsWallets } from "@cinegather/database";
import { z } from "zod";
import { db, database } from "../../apps/api/src/core/context";
import { verifyPointsAccount } from "../../apps/api/src/modules/points/service";

// Server-side, read-only audit. No management API may edit balances or history.
const { values } = parseArgs({ options: { user: { type: "string" } } });
let checked = 0,
  failed = 0,
  cursor: string | undefined;
try {
  if (values.user) {
    const userId = z.uuid().parse(values.user),
      result = await verifyPointsAccount(userId);
    console.log(JSON.stringify({ userId, ...result }));
    checked++;
    if (!result.ok) failed++;
  } else {
    while (true) {
      const rows = await db
        .select({ userId: pointsWallets.userId })
        .from(pointsWallets)
        .where(cursor ? gt(pointsWallets.userId, cursor) : undefined)
        .orderBy(pointsWallets.userId)
        .limit(100);
      if (!rows.length) break;
      for (const { userId } of rows) {
        const result = await verifyPointsAccount(userId);
        checked++;
        if (!result.ok) {
          failed++;
          console.error(JSON.stringify({ userId, ...result }));
        }
      }
      cursor = rows.at(-1)!.userId;
    }
  }
  console.log(
    JSON.stringify({ event: "points.audit_complete", checked, failed }),
  );
  if (failed) process.exitCode = 1;
} finally {
  await database.pool.end();
}
