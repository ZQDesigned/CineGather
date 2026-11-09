CREATE TABLE points_policies (
 version integer PRIMARY KEY CHECK(version>0), rules jsonb NOT NULL,
 reason text NOT NULL, actor_id uuid, actor_name text NOT NULL, actor_username text,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO points_policies(version,rules,reason,actor_name) VALUES(1,
 '{"enabled":true,"dailyCap":100,"games":{"party.draw":{"firstCorrect":10,"painter":5},"party.quiz":{"firstCorrect":10,"painter":0}}}',
 '初始游戏积分规则','系统');
-- Deliberately no account/room cascade: financial audit survives their deletion.
CREATE TABLE points_wallets (
 user_id uuid PRIMARY KEY, balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991),
 day text NOT NULL, earned integer NOT NULL DEFAULT 0 CHECK(earned>=0),
 sequence integer NOT NULL DEFAULT 0 CHECK(sequence>=0), head_hash text NOT NULL DEFAULT ''
);
CREATE TABLE points_ledger (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
 display_name text NOT NULL, username text, room_id uuid NOT NULL, match_id uuid NOT NULL, round_id uuid NOT NULL,
 game text NOT NULL, reward text NOT NULL, attempt integer NOT NULL CHECK(attempt>=0),
 expected integer NOT NULL CHECK(expected>=0), amount integer NOT NULL CHECK(amount>=0 AND amount<=expected),
 balance_before bigint NOT NULL CHECK(balance_before>=0), balance_after bigint NOT NULL CHECK(balance_after=balance_before+amount),
 day text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('awarded','capped','disabled','no_reward')),
 applied_cap integer NOT NULL CHECK(applied_cap>=0), settlement_policy_version integer NOT NULL REFERENCES points_policies(version),
 policy_version integer NOT NULL REFERENCES points_policies(version), policy jsonb NOT NULL, facts jsonb NOT NULL DEFAULT '{}',
 trace_id uuid NOT NULL, previous_hash text NOT NULL, entry_hash text NOT NULL, created_at timestamptz NOT NULL,
 CONSTRAINT points_event_unique UNIQUE(user_id,game,match_id,round_id,reward),
 CONSTRAINT points_sequence_unique UNIQUE(user_id,sequence)
);
CREATE INDEX points_user_day_idx ON points_ledger(user_id,day);
CREATE INDEX points_created_idx ON points_ledger(created_at);
CREATE FUNCTION points_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'points history is immutable'; END; $$;
CREATE TRIGGER points_ledger_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON points_ledger FOR EACH STATEMENT EXECUTE FUNCTION points_reject_mutation();
CREATE TRIGGER points_policies_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON points_policies FOR EACH STATEMENT EXECUTE FUNCTION points_reject_mutation();
ALTER TABLE admin_roles DROP CONSTRAINT admin_roles_permissions_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_permissions_check CHECK (
 jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions) BETWEEN 1 AND 21
 AND permissions <@ '["overview.read","users.read","users.manage","users.screen-share","users.game-host","users.esports","users.high-frame-rate","users.room-capacity","rooms.read","rooms.manage","games.read","games.manage","audit.read","announcements.read","announcements.manage","party-words.read","party-words.manage","party-submissions.read","party-submissions.review","points.read","points.manage"]'::jsonb
);
