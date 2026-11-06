import {
  pgTable,
  uuid,
  integer,
  jsonb,
  boolean,
  text,
  timestamp,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { rooms, users } from "./schema";
export const roomActivities = pgTable("room_activities", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  state: jsonb("state").notNull(),
});
export const activityPermissions = pgTable(
  "activity_permissions",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    board: boolean("board").notNull().default(true),
    game: boolean("game").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);
export const whiteboardSnapshots = pgTable(
  "whiteboard_snapshots",
  {
    id: uuid("id").primaryKey(),
    activityId: uuid("activity_id").notNull(),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    document: jsonb("document").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("whiteboard_snapshot_revision").on(t.activityId, t.revision),
  ],
);
export const whiteboardRecords = pgTable(
  "whiteboard_records",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => whiteboardSnapshots.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.snapshotId] })],
);
export const whiteboardImages = pgTable("whiteboard_images", {
  id: uuid("id").primaryKey(),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  activityId: uuid("activity_id").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
