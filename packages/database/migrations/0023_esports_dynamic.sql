ALTER TABLE rooms ADD COLUMN esports_configuration jsonb NOT NULL DEFAULT '{"groups":[{"id":"a","name":"A 组","playerSeats":5,"coachSeats":0},{"id":"b","name":"B 组","playerSeats":5,"coachSeats":0}],"tacticalPauseSeconds":60}';
ALTER TABLE rooms ADD COLUMN esports_revision integer NOT NULL DEFAULT 1 CHECK (esports_revision > 0);
ALTER TABLE rooms ADD COLUMN esports_advanced boolean NOT NULL DEFAULT false;
ALTER TABLE rooms ADD COLUMN tactical_pause_until timestamptz;
ALTER TABLE rooms ADD COLUMN coach_voice_mode text NOT NULL DEFAULT 'auto' CHECK (coach_voice_mode IN ('auto','open','closed'));
ALTER TABLE rooms ADD COLUMN coach_voice_revision integer NOT NULL DEFAULT 1 CHECK (coach_voice_revision>0);
ALTER TABLE rooms DROP CONSTRAINT rooms_capacity_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_capacity_check CHECK (
 (mode='standard' AND max_members BETWEEN 2 AND capacity_limit AND capacity_limit BETWEEN 10 AND 25) OR (mode='esports' AND max_members BETWEEN 11 AND 52)
);
ALTER TABLE esports_seats ADD COLUMN feature_version integer NOT NULL DEFAULT 1 CHECK (feature_version IN (1,2));
ALTER TABLE esports_seats DROP CONSTRAINT esports_seat_kind_check;
ALTER TABLE esports_seats ADD CONSTRAINT esports_seat_kind_check CHECK (
 (kind IN ('player','coach') AND team IS NOT NULL AND team ~ '^[a-z0-9][a-z0-9-]{0,35}$') OR (kind IN ('director','audience') AND team IS NULL)
);
ALTER TABLE room_invites DROP CONSTRAINT invites_esports_seat_check;
ALTER TABLE room_invites ADD CONSTRAINT invites_esports_seat_check CHECK (
 CASE WHEN esports_seat IS NULL THEN esports_team IS NULL ELSE recipient_id IS NOT NULL AND (
  (esports_seat IN ('player','coach') AND esports_team IS NOT NULL AND esports_team ~ '^[a-z0-9][a-z0-9-]{0,35}$') OR
  (esports_seat IN ('director','audience') AND esports_team IS NULL)
 ) END
);
ALTER TABLE esports_watches DROP CONSTRAINT esports_watches_monitor_team_check;
ALTER TABLE esports_watches ADD CONSTRAINT esports_watches_monitor_team_check CHECK (monitor_team IS NULL OR monitor_team ~ '^[a-z0-9][a-z0-9-]{0,35}$');
