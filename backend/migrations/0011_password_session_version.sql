-- Bind each user session to the current credential generation.
-- Existing users and sessions start at generation 1 and remain valid.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version >= 1);
ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version >= 1);
CREATE INDEX IF NOT EXISTS idx_sessions_user_auth_version ON sessions(user_id,auth_version);
