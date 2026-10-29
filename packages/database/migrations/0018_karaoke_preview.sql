CREATE TABLE karaoke_stages (
 room_id uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0
);
CREATE TABLE karaoke_seats (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_id uuid NOT NULL REFERENCES user_credentials(id) ON DELETE CASCADE,
 PRIMARY KEY (room_id,user_id)
);
