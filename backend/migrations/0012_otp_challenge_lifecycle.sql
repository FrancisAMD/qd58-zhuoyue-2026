-- Track invalidation of a challenge when a newer code is requested for the same
-- phone and purpose. Existing challenges remain active until the next resend.
ALTER TABLE otp_challenges ADD COLUMN superseded_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_otp_active_phone_purpose
  ON otp_challenges(phone,purpose,created_at DESC)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;
