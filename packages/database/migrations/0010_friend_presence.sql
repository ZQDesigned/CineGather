ALTER TABLE users ADD COLUMN presence_visibility text NOT NULL DEFAULT 'online'
  CHECK (presence_visibility IN ('online', 'invisible'));
--> statement-breakpoint
ALTER TABLE user_credentials ADD COLUMN presence_at timestamptz;
