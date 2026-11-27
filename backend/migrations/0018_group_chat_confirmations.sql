-- Confirmed group-chat membership is stored per user and regional group.
-- The QR upload timestamp snapshot allows an overwritten QR to require reconfirmation
-- without deleting the user's previous confirmation record.
CREATE TABLE IF NOT EXISTS group_chat_confirmations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_key TEXT NOT NULL,
  university_id_snapshot TEXT NOT NULL,
  qr_uploaded_at_snapshot TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(user_id,region_key),
  CHECK(length(trim(region_key))>0),
  CHECK(length(trim(university_id_snapshot))>0),
  CHECK(length(trim(qr_uploaded_at_snapshot))>0)
);
CREATE INDEX IF NOT EXISTS idx_group_chat_confirmations_region
  ON group_chat_confirmations(region_key,confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_chat_confirmations_user
  ON group_chat_confirmations(user_id,confirmed_at DESC);
