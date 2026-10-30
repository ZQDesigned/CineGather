import { z } from "zod";
export const announcementInput = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  kind: z.enum(["notice", "maintenance"]).default("notice"),
  popup: z.boolean().default(true),
  startsAt: z.iso.datetime().nullable().default(null),
  expiresAt: z.iso.datetime().nullable().default(null),
});
export const announcementSchema = z.object({
  id: z.uuid(),
  title: z.string().max(120),
  body: z.string().max(4000),
  kind: z.enum(["notice", "maintenance"]),
  popup: z.boolean(),
  startsAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  state: z.enum(["draft", "scheduled", "active", "expired", "withdrawn"]),
});
export const announcementFeedSchema = z.object({
  serverTime: z.iso.datetime(),
  items: z.array(announcementSchema).max(150),
});
export const announcementInboxSchema = z.object({
  serverTime: z.iso.datetime(),
  items: z
    .array(
      announcementSchema.extend({ received: z.boolean(), read: z.boolean() }),
    )
    .max(150),
});
export const adminAnnouncementsSchema = z.object({
  items: z.array(announcementSchema).max(50),
  total: z.number().int().nonnegative(),
});
export const announcementReceiptSchema = z.object({ remind: z.boolean() });
export type Announcement = z.infer<typeof announcementSchema>;
export type AnnouncementInput = z.infer<typeof announcementInput>;
export type AnnouncementFeed = z.infer<typeof announcementFeedSchema>;
export type AnnouncementInbox = z.infer<typeof announcementInboxSchema>;
export const announcementIdsInput = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "公告不能重复"),
});
export const announcementClaimsSchema = z.object({
  remindIds: z.array(z.uuid()).max(100),
});
