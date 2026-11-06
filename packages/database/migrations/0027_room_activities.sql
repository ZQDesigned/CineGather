CREATE TABLE room_activities (
 room_id uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0,
 state jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE activity_permissions (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 board boolean NOT NULL DEFAULT true,
 game boolean NOT NULL DEFAULT true,
 PRIMARY KEY(room_id,user_id)
);
--> statement-breakpoint
CREATE TABLE whiteboard_snapshots (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL,
 revision integer NOT NULL,
 title text NOT NULL,
 document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whiteboard_snapshot_revision ON whiteboard_snapshots(activity_id,revision);
--> statement-breakpoint
CREATE TABLE whiteboard_records (
 snapshot_id uuid NOT NULL REFERENCES whiteboard_snapshots(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,snapshot_id)
);
--> statement-breakpoint
CREATE TABLE whiteboard_images (
 id uuid PRIMARY KEY,
 room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
 activity_id uuid NOT NULL,
 data text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
