import { z } from "zod";

export const notificationPreferencesSchema = z.strictObject({
  enabled: z.boolean().default(true),
  desktop: z.boolean().default(true),
  sound: z.boolean().default(true),
  volume: z.number().min(0).max(100).default(30),
  preview: z.boolean().default(true),
  doNotDisturb: z.boolean().default(false),
  chat: z.boolean().default(true),
  friends: z.boolean().default(true),
  requests: z.boolean().default(true),
  system: z.boolean().default(true),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export const defaultNotificationPreferences =
  notificationPreferencesSchema.parse({});

export const clientNotificationSchema = z.strictObject({
  eventId: z.string().min(1).max(200),
  groupId: z.string().min(1).max(200).optional(),
  category: z.enum([
    "chat",
    "friends",
    "invitation",
    "room-request",
    "share-request",
    "system",
  ]),
  title: z.string().min(1).max(120),
  body: z.string().max(300).optional(),
  target: z.enum([
    "chat",
    "room",
    "friends",
    "room-invitations",
    "room-requests",
    "share",
    "diagnostics",
    "updates",
  ]),
  roomId: z.string().min(1).max(128).optional(),
  entityId: z.string().min(1).max(128).optional(),
  expiresAt: z.number().finite().optional(),
});
export type ClientNotification = z.infer<typeof clientNotificationSchema>;
export const notificationRecordSchema = clientNotificationSchema.extend({
  id: z.string().min(1).max(200),
  createdAt: z.number().finite(),
  count: z.number().int().min(1).max(100000),
  read: z.boolean(),
  active: z.boolean(),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

export const desktopNotificationSchema = z.strictObject({
  id: z.string().min(1).max(200),
  scope: z.string().min(1).max(500),
  title: z.string().min(1).max(120),
  body: z.string().max(300).optional(),
});
export type DesktopNotification = z.infer<typeof desktopNotificationSchema>;
