import { sql } from "drizzle-orm";
import {
  pgTable,
  boolean,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  screenShareEnabled: boolean("screen_share_enabled").notNull().default(false),
  presenceVisibility: text("presence_visibility").notNull().default("online"),
  disabledAt: time("disabled_at"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const adminRoles = pgTable("admin_roles", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  permissions: jsonb("permissions").$type<string[]>().notNull(),
  builtIn: boolean("built_in").notNull().default(false),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_idx").on(t.roleId),
  ],
);
export const credentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    secretHash: text("secret_hash").notNull().unique(),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
    presenceAt: time("presence_at"),
    createdAt: time("created_at"),
    deviceName: text("device_name").notNull().default("未知设备"),
    clientPlatform: text("client_platform").notNull().default("unknown"),
    clientVersion: text("client_version"),
    loginAddress: text("login_address"),
  },
  (t) => [
    index("credentials_presence_idx")
      .on(t.userId, t.presenceAt.desc())
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
export const settings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  settings: jsonb("settings_json").notNull(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull().unique(),
    passwordHash: text("password_hash"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    maxMembers: integer("max_members").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("rooms_code_check", sql`${t.code} ~ '^[A-F0-9]{8}$'`),
    check("rooms_capacity_check", sql`${t.maxMembers} BETWEEN 2 AND 10`),
    check("rooms_status_check", sql`${t.status} IN ('active', 'closed')`),
  ],
);
export const roomMemberPermissions = pgTable(
  "room_member_permissions",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    microphoneAllowed: boolean("microphone_allowed").notNull().default(true),
    sharingAllowed: boolean("sharing_allowed").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);
export const members = pgTable(
  "room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    joinedAt: time("joined_at").notNull().defaultNow(),
    admittedUntil: time("admitted_until"),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index("members_user_idx").on(t.userId),
    check("members_role_check", sql`${t.role} IN ('owner', 'member')`),
  ],
);
export const invites = pgTable(
  "room_invites",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: time("expires_at").notNull(),
    maxUses: integer("max_uses").notNull(),
    useCount: integer("use_count").notNull().default(0),
    revokedAt: time("revoked_at"),
    recipientId: uuid("recipient_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("invites_room_idx").on(t.roomId),
    index("invites_recipient_idx")
      .on(t.recipientId, t.expiresAt)
      .where(sql`${t.recipientId} IS NOT NULL AND ${t.revokedAt} IS NULL`),
    check(
      "invites_uses_check",
      sql`${t.maxUses} > 0 AND ${t.useCount} >= 0 AND ${t.useCount} <= ${t.maxUses}`,
    ),
  ],
);
export const roomJoinRequests = pgTable(
  "room_join_requests",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: time("created_at").notNull().defaultNow(),
    expiresAt: time("expires_at").notNull(),
    inviteId: uuid("invite_id").references(() => invites.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("room_requests_recipient_idx").on(t.recipientId, t.expiresAt),
    index("room_requests_requester_idx").on(t.requesterId, t.createdAt),
    check(
      "room_requests_status_check",
      sql`${t.status} IN ('pending', 'approved', 'rejected')`,
    ),
    check("room_requests_not_self", sql`${t.requesterId} <> ${t.recipientId}`),
  ],
);
export const leases = pgTable(
  "share_leases",
  {
    roomId: uuid("room_id")
      .primaryKey()
      .references(() => rooms.id, { onDelete: "cascade" }),
    holderUserId: uuid("holder_user_id").references(() => users.id),
    credentialId: uuid("credential_id").references(() => credentials.id),
    leaseId: uuid("lease_id"),
    expiresAt: time("expires_at"),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    check(
      "leases_consistency_check",
      sql`num_nonnulls(${t.holderUserId}, ${t.leaseId}, ${t.expiresAt}) IN (0, 3)`,
    ),
    check("leases_revision_check", sql`${t.revision} >= 0`),
  ],
);
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  targetId: uuid("target_id"),
  createdAt: time("created_at").notNull().defaultNow(),
  details: jsonb("details").notNull().default({}),
});
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("messages_room_time_idx").on(t.roomId, t.createdAt, t.id),
    check(
      "message_length_check",
      sql`char_length(${t.body}) BETWEEN 1 AND 2000`,
    ),
  ],
);
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    requesterRemark: text("requester_remark").notNull().default(""),
    recipientRemark: text("recipient_remark").notNull().default(""),
    requesterPinnedAt: time("requester_pinned_at"),
    recipientPinnedAt: time("recipient_pinned_at"),
    requesterVolume: integer("requester_volume").notNull().default(100),
    recipientVolume: integer("recipient_volume").notNull().default(100),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.recipientId] }),
    uniqueIndex("friendships_pair_idx").on(t.requesterId, t.recipientId),
    check(
      "friendships_identity_check",
      sql`${t.requesterId} <> ${t.recipientId}`,
    ),
    check(
      "friendships_status_check",
      sql`${t.status} IN ('pending', 'accepted')`,
    ),
    check(
      "friendships_remark_length",
      sql`char_length(${t.requesterRemark}) <= 50 AND char_length(${t.recipientRemark}) <= 50`,
    ),
    check(
      "friendships_volume_range",
      sql`${t.requesterVolume} BETWEEN 0 AND 200 AND ${t.recipientVolume} BETWEEN 0 AND 200`,
    ),
  ],
);
export const bans = pgTable(
  "room_bans",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);
export const idempotency = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const nativePublications = pgTable("native_publications", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  leaseId: uuid("lease_id").notNull(),
  revision: integer("revision").notNull(),
  holderUserId: uuid("holder_user_id")
    .notNull()
    .references(() => users.id),
  credentialId: uuid("credential_id").references(() => credentials.id),
  ingressId: text("ingress_id").notNull().unique(),
  identity: text("identity").notNull().unique(),
});

export const registrationPolicy = pgTable(
  "registration_policy",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(false),
    screenShareDefaultEnabled: boolean("screen_share_default_enabled")
      .notNull()
      .default(false),
  },
  (t) => [check("registration_policy_singleton", sql`${t.id} = 1`)],
);

export const roomSessions = pgTable(
  "room_sessions",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    admittedUntil: time("admitted_until"),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.credentialId] }),
    index("room_sessions_credential_idx").on(t.credentialId),
  ],
);

export const shareRequests = pgTable(
  "share_requests",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id").notNull(),
    revision: integer("revision").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: time("created_at").notNull().defaultNow(),
    expiresAt: time("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("share_requests_member_idx").on(t.roomId, t.userId),
    index("share_requests_room_idx").on(t.roomId, t.createdAt),
    check(
      "share_requests_status_check",
      sql`${t.status} IN ('pending','approved')`,
    ),
  ],
);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull().default("notice"),
    popup: boolean("popup").notNull().default(true),
    status: text("status").notNull().default("draft"),
    startsAt: time("starts_at"),
    expiresAt: time("expires_at"),
    publishedAt: time("published_at"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "announcements_status_check",
      sql`${t.status} IN ('draft','scheduled','published','withdrawn')`,
    ),
    check(
      "announcements_kind_check",
      sql`${t.kind} IN ('notice','maintenance')`,
    ),
    check(
      "announcements_text_check",
      sql`length(${t.title}) BETWEEN 1 AND 120 AND length(${t.body}) BETWEEN 1 AND 4000`,
    ),
    check(
      "announcements_time_check",
      sql`${t.expiresAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.expiresAt}>${t.startsAt}`,
    ),
    index("announcements_due_idx").on(t.status, t.startsAt),
    index("announcements_published_idx").on(t.publishedAt),
  ],
);
export const announcementReceipts = pgTable(
  "announcement_receipts",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receivedAt: time("received_at").notNull().defaultNow(),
    readAt: time("read_at"),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);
