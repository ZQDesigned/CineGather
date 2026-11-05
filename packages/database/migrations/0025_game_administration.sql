ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 15
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","users.game-host","users.esports","users.high-frame-rate","users.room-capacity","rooms.read","rooms.manage","games.read","games.manage","audit.read","announcements.read","announcements.manage"]'::jsonb
);
