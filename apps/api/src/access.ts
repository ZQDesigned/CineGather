import { eq, inArray, sql } from "drizzle-orm";
import {
  users,
  adminRoles,
  userRoles,
  type Database,
  type Transaction,
} from "@cinegather/database";
import {
  adminPermissionKeys,
  hasAdminPermission,
  type AdminPermission,
} from "@cinegather/contracts";
import { fail } from "./errors";
type AccessDb = Pick<Database, "select">;
export const rbacLock = 839215;
export async function rolesForUsers(db: AccessDb, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({
      userId: userRoles.userId,
      id: adminRoles.id,
      name: adminRoles.name,
      permissions: adminRoles.permissions,
    })
    .from(userRoles)
    .innerJoin(adminRoles, eq(adminRoles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, ids))
    .orderBy(adminRoles.name, adminRoles.id);
}
export async function readAccess(
  db: AccessDb,
  id: string,
  isSuperAdmin: boolean,
) {
  const rows = await rolesForUsers(db, [id]);
  const permissions = isSuperAdmin
    ? [...adminPermissionKeys]
    : adminPermissionKeys.filter((permission) =>
        rows.some((role) => role.permissions.includes(permission)),
      );
  return {
    isSuperAdmin,
    roles: rows.map(({ id, name }) => ({ id, name })),
    permissions,
  };
}
export async function requireManagement(
  tx: Transaction,
  id: string,
  permission: AdminPermission,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${rbacLock})`);
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, id))
    .for("share");
  if (!user?.username || user.disabledAt)
    fail(403, "ADMIN_REQUIRED", "管理权限已失效");
  const access = await readAccess(tx, id, user.isSuperAdmin);
  if (!hasAdminPermission(access, permission))
    fail(403, "PERMISSION_DENIED", "没有执行此操作的权限");
  return access;
}
export async function requireSuperAdmin(tx: Transaction, id: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${rbacLock})`);
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, id))
    .for("share");
  if (!user?.username || user.disabledAt || !user.isSuperAdmin)
    fail(403, "SUPERADMIN_REQUIRED", "仅超级管理员可以执行此管理操作");
}
