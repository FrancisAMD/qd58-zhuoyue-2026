-- Support bounded scheduled cleanup without full-table scans.
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_consumed_at ON otp_challenges(consumed_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_started_at ON rate_limits(window_started_at);
