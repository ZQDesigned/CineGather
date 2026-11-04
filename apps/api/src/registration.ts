import {
  registrationPolicy,
  type Transaction,
  type Database,
} from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { sql } from "drizzle-orm";
import { db, audit } from "./context";
import { config } from "./config";
import { requireSuperAdmin } from "./access";
export const registrationLock = 839216;
export async function readRegistrationPolicy(
  store: Pick<Database, "select"> | Transaction = db,
) {
  const [policy] = await store.select().from(registrationPolicy);
  return {
    enabled: policy?.enabled ?? config.registrationEnabled,
    screenShareDefaultEnabled: policy?.screenShareDefaultEnabled ?? false,
    gameHostDefaultEnabled: policy?.gameHostDefaultEnabled ?? false,
  };
}
export async function updateRegistrationPolicy(
  user: User,
  input: {
    enabled: boolean;
    screenShareDefaultEnabled?: boolean;
    gameHostDefaultEnabled?: boolean;
    reason: string;
  },
) {
  return db.transaction(async (tx) => {
    await requireSuperAdmin(tx, user.id);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${registrationLock})`);
    const previous = await readRegistrationPolicy(tx);
    const gameHostDefaultEnabled =
      input.gameHostDefaultEnabled ?? previous.gameHostDefaultEnabled;
    const screenShareDefaultEnabled =
      input.screenShareDefaultEnabled ?? previous.screenShareDefaultEnabled;
    await tx
      .insert(registrationPolicy)
      .values({
        id: 1,
        enabled: input.enabled,
        screenShareDefaultEnabled,
        gameHostDefaultEnabled,
      })
      .onConflictDoUpdate({
        target: registrationPolicy.id,
        set: {
          enabled: input.enabled,
          screenShareDefaultEnabled,
          gameHostDefaultEnabled,
        },
      });
    await audit(tx, user.id, "admin.registration_updated", undefined, {
      previousEnabled: previous.enabled,
      previousScreenShareDefaultEnabled: previous.screenShareDefaultEnabled,
      previousGameHostDefaultEnabled: previous.gameHostDefaultEnabled,
      gameHostDefaultEnabled,
      screenShareDefaultEnabled,
      enabled: input.enabled,
      reason: input.reason,
    });
    return {
      enabled: input.enabled,
      screenShareDefaultEnabled,
      gameHostDefaultEnabled,
    };
  });
}
