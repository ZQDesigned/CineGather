ALTER TABLE users ADD COLUMN is_super_admin boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE admin_roles (
 id uuid PRIMARY KEY,
 name text NOT NULL UNIQUE,
 permissions jsonb NOT NULL,
 built_in boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT admin_roles_permissions_check CHECK (
  jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) BETWEEN 1 AND 6
  AND permissions <@ '["overview.read","users.read","users.manage","rooms.read","rooms.manage","audit.read"]'::jsonb
 )
);
--> statement-breakpoint
CREATE TABLE user_roles (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role_id uuid NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
 PRIMARY KEY (user_id,role_id)
);
--> statement-breakpoint
CREATE INDEX user_roles_role_idx ON user_roles(role_id);
--> statement-breakpoint
INSERT INTO admin_roles (id,name,permissions,built_in) VALUES (
 '00000000-0000-4000-8000-000000000001','普通管理员',
 '["overview.read","users.read","users.manage","rooms.read","rooms.manage","audit.read"]',true
);
--> statement-breakpoint
INSERT INTO user_roles (user_id,role_id)
 SELECT id,'00000000-0000-4000-8000-000000000001'::uuid FROM users WHERE role='admin';
--> statement-breakpoint
ALTER TABLE users DROP CONSTRAINT users_admin_account_check;
--> statement-breakpoint
ALTER TABLE users DROP CONSTRAINT users_role_check;
--> statement-breakpoint
ALTER TABLE users DROP COLUMN role;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_superadmin_account_check CHECK (NOT is_super_admin OR username IS NOT NULL);
