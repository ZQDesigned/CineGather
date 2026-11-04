ALTER TABLE users ADD COLUMN game_host_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE registration_policy ADD COLUMN game_host_default_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE game_sessions (
 id uuid PRIMARY KEY, code text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'), name text NOT NULL, game text NOT NULL DEFAULT 'minecraft-java', game_version text,
 host_user_id uuid NOT NULL REFERENCES users(id), host_credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'starting' CHECK (status IN ('starting','open','recovering','ended')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0), max_members integer NOT NULL DEFAULT 8 CHECK (max_members=8),
 created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE UNIQUE INDEX game_host_active_idx ON game_sessions(host_user_id) WHERE status<>'ended';
CREATE TABLE game_members (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('host','guest')), status text NOT NULL DEFAULT 'approved', active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0), lease_until timestamptz NOT NULL, reserved_until timestamptz NOT NULL,
 route text CHECK (route IS NULL OR route IN ('p2p','relay')), tunnel_secret_hash text, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT game_member_state_check CHECK(status IN ('approved','connecting','connected','reconnecting','left','removed') AND active=(status NOT IN ('left','removed')))
);
CREATE UNIQUE INDEX game_member_pair_idx ON game_members(session_id,user_id);
CREATE UNIQUE INDEX game_member_active_idx ON game_members(user_id) WHERE active=true;
CREATE INDEX game_member_lease_idx ON game_members(lease_until) WHERE active=true;
CREATE TABLE game_join_requests (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX game_request_pending_idx ON game_join_requests(session_id,user_id) WHERE status='pending';
CREATE TABLE game_invites (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_invite_recipient_idx ON game_invites(recipient_id);
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 13
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","users.game-host","users.esports","users.high-frame-rate","users.room-capacity","rooms.read","rooms.manage","audit.read","announcements.read","announcements.manage"]'::jsonb
);
