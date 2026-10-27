ALTER TABLE user_credentials ADD COLUMN created_at timestamptz;
ALTER TABLE user_credentials ADD COLUMN device_name text NOT NULL DEFAULT '未知设备';
ALTER TABLE user_credentials ADD COLUMN client_platform text NOT NULL DEFAULT 'unknown';
ALTER TABLE user_credentials ADD COLUMN client_version text;
ALTER TABLE user_credentials ADD COLUMN login_address text;
ALTER TABLE share_leases ADD COLUMN credential_id uuid REFERENCES user_credentials(id);
ALTER TABLE native_publications ADD COLUMN credential_id uuid REFERENCES user_credentials(id);
CREATE TABLE room_sessions (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 admitted_until timestamptz,
 PRIMARY KEY(room_id,credential_id)
);
CREATE INDEX room_sessions_credential_idx ON room_sessions(credential_id);
