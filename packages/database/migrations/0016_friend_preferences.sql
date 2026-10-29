ALTER TABLE friendships
 ADD COLUMN requester_remark text NOT NULL DEFAULT '',
 ADD COLUMN recipient_remark text NOT NULL DEFAULT '',
 ADD COLUMN requester_pinned_at timestamptz,
 ADD COLUMN recipient_pinned_at timestamptz,
 ADD CONSTRAINT friendships_remark_length CHECK (char_length(requester_remark) <= 50 AND char_length(recipient_remark) <= 50);
