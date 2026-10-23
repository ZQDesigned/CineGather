ALTER TABLE users ADD COLUMN username text UNIQUE;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN password_hash text;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_account_check CHECK (
  (username IS NULL AND password_hash IS NULL) OR
  (username ~ '^[a-z0-9_]{3,32}$' AND password_hash IS NOT NULL)
);
