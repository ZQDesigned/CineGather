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
export const credentials = pgTable("user_credentials", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  secretHash: text("secret_hash").notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  revokedAt: time("revoked_at"),
});
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
  },
  (t) => [
    index("invites_room_idx").on(t.roomId),
    check(
      "invites_uses_check",
      sql`${t.maxUses} > 0 AND ${t.useCount} >= 0 AND ${t.useCount} <= ${t.maxUses}`,
    ),
  ],
);
export const leases = pgTable(
  "share_leases",
  {
    roomId: uuid("room_id")
      .primaryKey()
      .references(() => rooms.id, { onDelete: "cascade" }),
    holderUserId: uuid("holder_user_id").references(() => users.id),
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
  ingressId: text("ingress_id").notNull().unique(),
  identity: text("identity").notNull().unique(),
});
