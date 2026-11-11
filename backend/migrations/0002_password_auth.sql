ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE otp_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE otp_challenges ADD COLUMN out_id TEXT;
CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose_created ON otp_challenges(phone,purpose,created_at DESC);
