import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { adminRoles, userRoles, users } from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { db, audit } from "./context";
import { requireSuperAdmin } from "./access";
import { fail, uuid } from "./errors";
type RoleInput = { name: string; permissions: string[]; reason: string };
const publicRole = (r: typeof adminRoles.$inferSelect, memberCount = 0) => ({
  id: r.id,
  name: r.name,
  permissions: r.permissions,
  builtIn: r.builtIn,
  memberCount,
  createdAt: r.createdAt.toISOString(),
});
function duplicate(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (("code" in error && error.code === "23505") ||
      ("cause" in error && duplicate(error.cause)))
  );
}
export async function listRoles() {
  const [roles, counts] = await Promise.all([
    db
      .select()
      .from(adminRoles)
      .orderBy(adminRoles.createdAt, adminRoles.id)
      .limit(100),
    db
      .select({
        roleId: userRoles.roleId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(userRoles)
      .groupBy(userRoles.roleId),
  ]);
  return {
    items: roles.map((r) =>
      publicRole(r, counts.find((c) => c.roleId === r.id)?.count ?? 0),
    ),
  };
}
export async function createRole(actor: User, input: RoleInput) {
  try {
    return await db.transaction(async (tx) => {
      await requireSuperAdmin(tx, actor.id);
      if (
        (await tx.select({ id: adminRoles.id }).from(adminRoles).limit(100))
          .length >= 100
      )
        fail(409, "ROLE_LIMIT", "角色数量已达到上限");
      const [role] = await tx
        .insert(adminRoles)
        .values({
          id: randomUUID(),
          name: input.name,
          permissions: input.permissions,
        })
        .returning();
      await audit(tx, actor.id, "admin.role_created", role!.id, {
        targetName: role!.name,
        permissions: input.permissions,
        reason: input.reason,
      });
      return publicRole(role!);
    });
  } catch (error) {
    if (duplicate(error)) fail(409, "ROLE_NAME_TAKEN", "角色名称已存在");
    throw error;
  }
}
export async function updateRole(actor: User, id: string, input: RoleInput) {
  id = uuid(id);
  try {
    return await db.transaction(async (tx) => {
      await requireSuperAdmin(tx, actor.id);
      const [role] = await tx
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.id, id))
        .for("update");
      if (!role) fail(404, "ROLE_NOT_FOUND", "角色不存在");
      if (role.builtIn) fail(409, "BUILTIN_ROLE", "内置普通管理员角色不能修改");
      const [updated] = await tx
        .update(adminRoles)
        .set({
          name: input.name,
          permissions: input.permissions,
          updatedAt: new Date(),
        })
        .where(eq(adminRoles.id, id))
        .returning();
      const [assignedCount] = await tx
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(userRoles)
        .where(eq(userRoles.roleId, id));
      await audit(tx, actor.id, "admin.role_updated", id, {
        targetName: updated!.name,
        previousName: role.name,
        previousPermissions: role.permissions,
        permissions: input.permissions,
        reason: input.reason,
      });
      return publicRole(updated!, assignedCount!.count);
    });
  } catch (error) {
    if (duplicate(error)) fail(409, "ROLE_NAME_TAKEN", "角色名称已存在");
    throw error;
  }
}
export async function deleteRole(actor: User, id: string, reason: string) {
  id = uuid(id);
  await db.transaction(async (tx) => {
    await requireSuperAdmin(tx, actor.id);
    const [role] = await tx
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, id))
      .for("update");
    if (!role) fail(404, "ROLE_NOT_FOUND", "角色不存在");
    if (role.builtIn) fail(409, "BUILTIN_ROLE", "内置普通管理员角色不能删除");
    if (
      (
        await tx
          .select({ id: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, id))
          .limit(1)
      ).length
    )
      fail(409, "ROLE_IN_USE", "请先取消所有账号的此角色，再删除角色");
    await tx.delete(adminRoles).where(eq(adminRoles.id, id));
    await audit(tx, actor.id, "admin.role_deleted", id, {
      targetName: role.name,
      reason,
    });
  });
  return { ok: true as const };
}
export async function assignRoles(
  actor: User,
  id: string,
  input: { roleIds: string[]; reason: string },
) {
  id = uuid(id);
  await db.transaction(async (tx) => {
    await requireSuperAdmin(tx, actor.id);
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    if (!target?.username) fail(404, "USER_NOT_FOUND", "账号不存在");
    if (target.isSuperAdmin)
      fail(409, "SUPERADMIN_PROTECTED", "超级管理员只能通过服务端命令维护");
    if (target.disabledAt && input.roleIds.length)
      fail(409, "ACCOUNT_DISABLED", "请先启用账号再授予管理角色");
    const roles = input.roleIds.length
      ? await tx
          .select()
          .from(adminRoles)
          .where(inArray(adminRoles.id, input.roleIds))
      : [];
    if (roles.length !== input.roleIds.length)
      fail(400, "INVALID_ROLES", "部分角色已不存在，请重新选择");
    const previous = await tx
      .select({ id: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, id));
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    if (roles.length)
      await tx
        .insert(userRoles)
        .values(roles.map((r) => ({ userId: id, roleId: r.id })));
    await audit(tx, actor.id, "admin.user_roles_assigned", id, {
      targetName: target.username,
      previousRoleIds: previous.map((r) => r.id),
      roleIds: roles.map((r) => r.id),
      roleNames: roles.map((r) => r.name),
      reason: input.reason,
    });
  });
  return { ok: true as const };
}
