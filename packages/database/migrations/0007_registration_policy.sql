CREATE TABLE registration_policy (
 id integer PRIMARY KEY DEFAULT 1,
 enabled boolean NOT NULL DEFAULT false,
 CONSTRAINT registration_policy_singleton CHECK (id = 1)
);
