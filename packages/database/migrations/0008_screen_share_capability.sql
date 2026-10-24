ALTER TABLE users ADD COLUMN screen_share_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE registration_policy ADD COLUMN screen_share_default_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
--> statement-breakpoint
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions) = 'array'
 AND jsonb_array_length(permissions) BETWEEN 1 AND 7
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","rooms.read","rooms.manage","audit.read"]'::jsonb
);
