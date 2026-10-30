import { z } from "zod";
import {
  accountRoleSchema,
  adminPermissionSchema,
  adminPermissionKeys,
} from "./permissions";
export const adminQuery = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export const adminReason = z.strictObject({
  reason: z.string().trim().min(2).max(200),
});
export const adminUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  isSuperAdmin: z.boolean(),
  screenShareEnabled: z.boolean(),
  roles: z.array(accountRoleSchema),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
  activeSessions: z.number(),
});
export const adminRoomSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  ownerName: z.string(),
  status: z.enum(["active", "closed"]),
  access: z.enum(["normal", "password"]),
  memberCount: z.number(),
  maxMembers: z.number(),
  sharing: z.boolean(),
  createdAt: z.string(),
});
export const adminAuditSchema = z.object({
  id: z.uuid(),
  actorName: z.string(),
  action: z.string(),
  targetName: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});
export const adminOverviewSchema = z.object({
  accounts: z.number(),
  disabledAccounts: z.number(),
  activeRooms: z.number(),
  activeSessions: z.number(),
  service: z.enum(["available", "degraded"]),
  version: z.string(),
});
export const adminUsersSchema = z.object({
  items: z.array(adminUserSchema),
  total: z.number(),
});
export const adminRoomsSchema = z.object({
  items: z.array(adminRoomSchema),
  total: z.number(),
});
export const adminAuditsSchema = z.object({
  items: z.array(adminAuditSchema),
  total: z.number(),
});
export type AdminQuery = z.infer<typeof adminQuery>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminRoom = z.infer<typeof adminRoomSchema>;
export type AdminAudit = z.infer<typeof adminAuditSchema>;
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminRoleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  permissions: z.array(adminPermissionSchema),
  builtIn: z.boolean(),
  memberCount: z.number(),
  createdAt: z.string(),
});
export const adminRolesSchema = z.object({ items: z.array(adminRoleSchema) });
export const adminRoleInput = z
  .strictObject({
    name: z.string().trim().min(1).max(32),
    permissions: z
      .array(adminPermissionSchema)
      .min(1)
      .max(adminPermissionKeys.length)
      .refine((p) => new Set(p).size === p.length, "权限不能重复"),
    reason: adminReason.shape.reason,
  })
  .superRefine((value, ctx) => {
    for (const [manage, read] of [
      ["users.manage", "users.read"],
      ["users.screen-share", "users.read"],
      ["rooms.manage", "rooms.read"],
      ["announcements.manage", "announcements.read"],
    ] as const)
      if (
        value.permissions.includes(manage) &&
        !value.permissions.includes(read)
      )
        ctx.addIssue({
          code: "custom",
          path: ["permissions"],
          message: "管理权限需要同时包含对应的查看权限",
        });
  });
export const adminRoleAssignment = z.strictObject({
  roleIds: z
    .array(z.uuid().toLowerCase())
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "角色不能重复"),
  reason: adminReason.shape.reason,
});
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminScreenShareInput = adminReason.extend({
  enabled: z.boolean(),
});
