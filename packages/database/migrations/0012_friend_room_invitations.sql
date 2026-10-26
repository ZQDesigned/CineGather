ALTER TABLE room_invites ADD COLUMN recipient_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE room_invites ADD COLUMN created_at timestamptz NOT NULL DEFAULT NOW();
CREATE INDEX invites_recipient_idx ON room_invites(recipient_id, expires_at)
  WHERE recipient_id IS NOT NULL AND revoked_at IS NULL;
