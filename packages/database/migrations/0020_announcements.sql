CREATE TABLE announcements (
 id uuid PRIMARY KEY, title text NOT NULL, body text NOT NULL,
 kind text NOT NULL DEFAULT 'notice', popup boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'draft', starts_at timestamptz, expires_at timestamptz, published_at timestamptz,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT announcements_status_check CHECK (status IN ('draft','scheduled','published','withdrawn')),
 CONSTRAINT announcements_kind_check CHECK (kind IN ('notice','maintenance')),
 CONSTRAINT announcements_text_check CHECK (length(title) BETWEEN 1 AND 120 AND length(body) BETWEEN 1 AND 4000),
 CONSTRAINT announcements_time_check CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at>starts_at)
);
CREATE INDEX announcements_due_idx ON announcements(status,starts_at);
CREATE INDEX announcements_published_idx ON announcements(published_at);
CREATE TABLE announcement_receipts (
 announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 received_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 PRIMARY KEY (announcement_id,user_id)
);
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 9
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","rooms.read","rooms.manage","audit.read","announcements.read","announcements.manage"]'::jsonb
);
