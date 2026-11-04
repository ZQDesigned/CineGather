import { afterAll, expect, test } from "bun:test";
import {
  createDatabase,
  users,
  auditLogs,
  gameSessions,
  gameMembers,
  adminRoles,
  userRoles,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
import { setCapabilities } from "../../apps/api/src/capabilities";
import {
  readRegistrationPolicy,
  updateRegistrationPolicy,
} from "../../apps/api/src/registration";
import { registerAccount } from "../../apps/api/src/accounts";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const ids: string[] = [];
const roles: string[] = [];
async function person(superAdmin = false) {
  const [u] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      displayName: "联机能力验证",
      username:
        "game_cap_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12),
      passwordHash: "local-test-fixture",
      isSuperAdmin: superAdmin,
    })
    .returning();
  ids.push(u!.id);
  return u!;
}
afterAll(async () => {
  if (ids.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  if (roles.length)
    await db.delete(adminRoles).where(inArray(adminRoles.id, roles));
  await pool.end();
});

test("new and existing accounts default to no Minecraft hosting and registration defaults remain explicit", async () => {
  const u = await person();
  expect(u.gameHostEnabled).toBe(false);
  expect((await readRegistrationPolicy()).gameHostDefaultEnabled).toBe(false);
  expect(gameSessions).toBeDefined();
  expect(gameMembers).toBeDefined();
});
test("only a superadmin or administrator with the dedicated permission may grant Minecraft hosting", async () => {
  const admin = await person(true),
    normal = await person(),
    target = await person();
  await expect(
    setCapabilities({ id: normal.id } as never, target.id, {
      gameHostEnabled: true,
      reason: "验证授权",
    }),
  ).rejects.toThrow();
  await setCapabilities({ id: admin.id } as never, target.id, {
    gameHostEnabled: true,
    reason: "验证授权",
  });
  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, target.id));
  expect(updated?.gameHostEnabled).toBe(true);
  expect(updated?.screenShareEnabled).toBe(false);
});

test("an administrator with only Minecraft hosting management can grant that capability but not screen sharing", async () => {
  const admin = await person(),
    target = await person();
  const id = crypto.randomUUID();
  roles.push(id);
  await db.insert(adminRoles).values({
    id,
    name: "game-cap-" + id.slice(0, 8),
    permissions: ["users.read", "users.game-host"],
  });
  await db.insert(userRoles).values({ userId: admin.id, roleId: id });
  await setCapabilities({ id: admin.id } as never, target.id, {
    gameHostEnabled: true,
    reason: "专有能力权限",
  });
  await expect(
    setCapabilities({ id: admin.id } as never, target.id, {
      screenShareEnabled: true,
      reason: "不可越权",
    }),
  ).rejects.toThrow();
  expect(
    (await db.select().from(users).where(eq(users.id, target.id)))[0]
      ?.gameHostEnabled,
  ).toBe(true);
});

test("registration hosting defaults affect only new accounts and are independent of screen sharing", async () => {
  const admin = await person(true),
    previous = await readRegistrationPolicy(),
    existing = await person();
  try {
    await updateRegistrationPolicy({ id: admin.id } as never, {
      enabled: true,
      gameHostDefaultEnabled: true,
      reason: "新账号能力默认值",
    });
    const registered = await registerAccount({
      username: "game_reg_" + crypto.randomUUID().slice(0, 8),
      displayName: "联机注册默认值验证",
      password: "Minecraft capability test 2026!",
    });
    ids.push(registered.user.id);
    expect(registered.user.gameHostEnabled).toBe(true);
    expect(
      (await db.select().from(users).where(eq(users.id, existing.id)))[0]
        ?.gameHostEnabled,
    ).toBe(false);
    expect(registered.user.screenShareEnabled).toBe(
      previous.screenShareDefaultEnabled,
    );
  } finally {
    await updateRegistrationPolicy({ id: admin.id } as never, {
      ...previous,
      reason: "恢复本地验证默认值",
    });
  }
});
