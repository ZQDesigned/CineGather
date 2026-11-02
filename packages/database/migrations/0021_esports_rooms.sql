ALTER TABLE users ADD COLUMN esports_rooms_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE rooms ADD COLUMN mode text NOT NULL DEFAULT 'standard';
ALTER TABLE rooms ADD CONSTRAINT rooms_mode_check CHECK (mode IN ('standard','esports'));
ALTER TABLE rooms DROP CONSTRAINT rooms_capacity_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_capacity_check CHECK (
 (mode='standard' AND max_members BETWEEN 2 AND 10) OR (mode='esports' AND max_members=20)
);
ALTER TABLE room_invites ADD COLUMN esports_seat text;
ALTER TABLE room_invites ADD COLUMN esports_team text;
ALTER TABLE room_invites ADD CONSTRAINT invites_esports_seat_check CHECK (
 CASE WHEN esports_seat IS NULL THEN esports_team IS NULL ELSE
 recipient_id IS NOT NULL AND (
  (esports_seat='player' AND esports_team IS NOT NULL AND esports_team IN ('a','b')) OR
  (esports_seat IN ('director','audience') AND esports_team IS NULL)
 ) END
);
CREATE TABLE esports_seats (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'audience', team text,
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 reserved_until timestamptz,
 PRIMARY KEY(room_id,user_id),
 CONSTRAINT esports_seat_kind_check CHECK (
   (kind='player' AND team IS NOT NULL AND team IN ('a','b')) OR (kind IN ('director','audience') AND team IS NULL)
 )
);
CREATE INDEX esports_seat_capacity_idx ON esports_seats(room_id,kind,team);
CREATE TABLE esports_publications (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 id uuid NOT NULL UNIQUE, lease_id uuid NOT NULL UNIQUE,
 revision integer NOT NULL CHECK (revision>0), seat_revision integer NOT NULL CHECK (seat_revision>0),
 video_active boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, system_audio boolean NOT NULL DEFAULT false,
 ingress_id text UNIQUE, identity text,
 PRIMARY KEY(room_id,user_id)
);
CREATE TABLE esports_watches (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 current uuid, warming uuid, warm_deadline timestamptz,
 current_grant_id uuid, warm_grant_id uuid, monitor_grant_id uuid,
 monitor_team text CHECK (monitor_team IN ('a','b')), auto_monitor boolean NOT NULL DEFAULT true,
 PRIMARY KEY(room_id,user_id),
 CONSTRAINT esports_warm_consistency CHECK ((warming IS NULL)=(warm_deadline IS NULL)),
 CONSTRAINT esports_warm_distinct CHECK (current IS NULL OR warming IS NULL OR current<>warming)
);
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 10
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","users.esports","rooms.read","rooms.manage","audit.read","announcements.read","announcements.manage"]'::jsonb
);
