ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_admin_account_check CHECK (role <> 'admin' OR username IS NOT NULL);
--> statement-breakpoint
UPDATE user_credentials SET revoked_at = now() WHERE kind <> 'account' AND revoked_at IS NULL;
