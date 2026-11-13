-- Add an explicit expiry time for pending leader transfers.
-- Existing records receive a deadline seven days after their original creation.
ALTER TABLE leader_transfers ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';

UPDATE leader_transfers
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days')
WHERE expires_at = '';

CREATE INDEX IF NOT EXISTS idx_transfers_status_expiry
  ON leader_transfers(status, expires_at);
