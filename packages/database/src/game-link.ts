import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { users, credentials } from "./schema";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    game: text("game")
      .$type<import("@cinegather/contracts").GameKind>()
      .notNull()
      .default("minecraft-java"),
    gameVersion: text("game_version"),
    hostUserId: uuid("host_user_id")
      .notNull()
      .references(() => users.id),
    hostCredentialId: uuid("host_credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("starting"),
    revision: integer("revision").notNull().default(1),
    maxMembers: integer("max_members").notNull().default(8),
    createdAt: time("created_at").notNull().defaultNow(),
    endedAt: time("ended_at"),
  },
  (t) => [
    check(
      "game_session_kind_check",
      sql`${t.game} IN ('minecraft-java','stardew-valley')`,
    ),
    check("game_session_code_check", sql`${t.code} ~ '^[A-HJ-NP-Z2-9]{8}$'`),
    check(
      "game_session_status_check",
      sql`${t.status} IN ('starting','open','recovering','ended')`,
    ),
    check(
      "game_session_revision_check",
      sql`${t.revision}>0 AND ${t.maxMembers}=8`,
    ),
    uniqueIndex("game_host_active_idx")
      .on(t.hostUserId)
      .where(sql`${t.status}<>'ended'`),
  ],
);
export const gameMembers = pgTable(
  "game_members",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("approved"),
    active: boolean("active").notNull().default(true),
    revision: integer("revision").notNull().default(1),
    leaseUntil: time("lease_until").notNull(),
    reservedUntil: time("reserved_until").notNull(),
    route: text("route"),
    tunnelSecretHash: text("tunnel_secret_hash"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_member_pair_idx").on(t.sessionId, t.userId),
    uniqueIndex("game_member_active_idx")
      .on(t.userId)
      .where(sql`${t.active}=true`),
    index("game_member_lease_idx")
      .on(t.leaseUntil)
      .where(sql`${t.active}=true`),
    check("game_member_role_check", sql`${t.role} IN ('host','guest')`),
    check(
      "game_member_state_check",
      sql`${t.status} IN ('approved','connecting','connected','reconnecting','left','removed') AND ${t.active}=(${t.status} NOT IN ('left','removed'))`,
    ),
    check("game_member_revision_check", sql`${t.revision}>0`),
    check(
      "game_member_route_check",
      sql`${t.route} IS NULL OR ${t.route} IN ('p2p','relay')`,
    ),
  ],
);
export const gameJoinRequests = pgTable(
  "game_join_requests",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    expiresAt: time("expires_at").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_request_pending_idx")
      .on(t.sessionId, t.userId)
      .where(sql`${t.status}='pending'`),
    check(
      "game_request_status_check",
      sql`${t.status} IN ('pending','approved','rejected','cancelled','expired')`,
    ),
  ],
);
export const gameInvites = pgTable(
  "game_invites",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: time("expires_at").notNull(),
    consumedAt: time("consumed_at"),
    revokedAt: time("revoked_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("game_invite_recipient_idx").on(t.recipientId)],
);
