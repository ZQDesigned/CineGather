CREATE TABLE party_first_correct (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 answer_key text NOT NULL, first_correct_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,answer_key)
);
CREATE TABLE party_submissions (
 id uuid PRIMARY KEY,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 display_name_snapshot text NOT NULL, username_snapshot text NOT NULL,
 draft jsonb NOT NULL, reviewed_draft jsonb,
 answer_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 version integer NOT NULL DEFAULT 1,
 word_id uuid REFERENCES party_word_bank(id) ON DELETE SET NULL,
 reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
 reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE UNIQUE INDEX party_submission_pending_answer ON party_submissions(answer_key) WHERE status='pending';
CREATE INDEX party_submission_user ON party_submissions(user_id,created_at);
CREATE INDEX party_submission_status ON party_submissions(status,created_at);
ALTER TABLE party_word_bank ADD COLUMN author_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE party_word_bank ADD COLUMN author_display_name_snapshot text;
ALTER TABLE party_word_bank ADD COLUMN author_username_snapshot text;

ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 19
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","users.game-host","users.esports","users.high-frame-rate","users.room-capacity","rooms.read","rooms.manage","games.read","games.manage","audit.read","announcements.read","announcements.manage","party-words.read","party-words.manage","party-submissions.read","party-submissions.review"]'::jsonb
);
