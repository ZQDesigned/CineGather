ALTER TABLE users ADD COLUMN high_frame_rate_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN standard_room_max_members integer NOT NULL DEFAULT 10
 CHECK (standard_room_max_members BETWEEN 10 AND 25);
ALTER TABLE rooms ADD COLUMN capacity_limit integer NOT NULL DEFAULT 10;
UPDATE rooms SET capacity_limit=20 WHERE mode='esports';
ALTER TABLE rooms DROP CONSTRAINT rooms_capacity_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_capacity_check CHECK (
 (mode='standard' AND capacity_limit BETWEEN 10 AND 25 AND max_members BETWEEN 2 AND capacity_limit)
 OR (mode='esports' AND max_members=20)
);
ALTER TABLE share_leases ADD COLUMN quality text NOT NULL DEFAULT 'cinema' CHECK (quality IN ('saver','cinema','game'));
ALTER TABLE esports_publications ADD COLUMN quality text NOT NULL DEFAULT 'cinema' CHECK (quality IN ('saver','cinema','game'));
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 12
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","users.esports","users.high-frame-rate","users.room-capacity","rooms.read","rooms.manage","audit.read","announcements.read","announcements.manage"]'::jsonb
);
