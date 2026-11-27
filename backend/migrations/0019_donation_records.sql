-- Public sponsor list. Records are curated by authorized administrators only.
CREATE TABLE IF NOT EXISTS donation_records (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32),
  nickname TEXT NOT NULL CHECK(length(trim(nickname)) BETWEEN 1 AND 40),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order BETWEEN -10000 AND 10000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_donation_records_order
  ON donation_records(display_order ASC,created_at ASC,id ASC);
