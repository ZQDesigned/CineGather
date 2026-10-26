CREATE TABLE room_join_requests (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  invite_id uuid REFERENCES room_invites(id) ON DELETE SET NULL,
  CONSTRAINT room_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT room_requests_not_self CHECK (requester_id <> recipient_id)
);
CREATE INDEX room_requests_recipient_idx ON room_join_requests(recipient_id, expires_at);
CREATE INDEX room_requests_requester_idx ON room_join_requests(requester_id, created_at);
