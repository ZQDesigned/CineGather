CREATE INDEX credentials_presence_idx ON user_credentials (user_id, presence_at DESC)
  WHERE revoked_at IS NULL;
