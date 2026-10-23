import { z } from "zod";
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
  role: z.enum(["user", "admin"]),
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
