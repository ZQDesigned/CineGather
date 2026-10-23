import { z } from "zod";
export const adminPermissionKeys = [
  "overview.read",
  "users.read",
  "users.manage",
  "rooms.read",
  "rooms.manage",
  "audit.read",
] as const;
export const adminPermissionSchema = z.enum(adminPermissionKeys);
export type AdminPermission = z.infer<typeof adminPermissionSchema>;
export const adminPermissionLabels: Record<AdminPermission, string> = {
  "overview.read": "查看概览",
  "users.read": "查看用户",
  "users.manage": "管理用户",
  "rooms.read": "查看房间",
  "rooms.manage": "管理房间",
  "audit.read": "查看操作记录",
};
export const accountRoleSchema = z.object({ id: z.uuid(), name: z.string() });
export interface AdminAccess {
  isSuperAdmin?: boolean;
  permissions?: readonly AdminPermission[];
}
export function hasAdminPermission(
  user: AdminAccess | undefined,
  permission: AdminPermission,
) {
  return !!user?.isSuperAdmin || !!user?.permissions?.includes(permission);
}
export function hasAdminAccess(user: AdminAccess | undefined) {
  return (
    !!user?.isSuperAdmin ||
    !!user?.permissions?.some((p) => adminPermissionKeys.includes(p))
  );
}
