ALTER TABLE game_sessions ADD CONSTRAINT game_session_kind_check CHECK (game IN ('minecraft-java','stardew-valley'));
