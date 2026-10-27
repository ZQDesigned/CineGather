CREATE TABLE share_requests (
 id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 lease_id uuid NOT NULL, revision integer NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX share_requests_member_idx ON share_requests(room_id,user_id);
CREATE INDEX share_requests_room_idx ON share_requests(room_id,created_at);
