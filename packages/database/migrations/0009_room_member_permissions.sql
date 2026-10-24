CREATE TABLE room_member_permissions (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  microphone_allowed boolean NOT NULL DEFAULT true,
  sharing_allowed boolean NOT NULL DEFAULT true,
  PRIMARY KEY (room_id, user_id)
);
