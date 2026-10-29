ALTER TABLE friendships
 ADD COLUMN requester_volume integer NOT NULL DEFAULT 100,
 ADD COLUMN recipient_volume integer NOT NULL DEFAULT 100,
 ADD CONSTRAINT friendships_volume_range CHECK (requester_volume BETWEEN 0 AND 200 AND recipient_volume BETWEEN 0 AND 200);
