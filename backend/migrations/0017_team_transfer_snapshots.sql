-- Preserve the school and participant identities as they were when a leader transfer was created.
-- Transfer rows are historical records and must survive profile reset or university reassignment.
ALTER TABLE leader_transfers ADD COLUMN from_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE leader_transfers ADD COLUMN to_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE leader_transfers ADD COLUMN university_id_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE leader_transfers ADD COLUMN university_name_snapshot TEXT NOT NULL DEFAULT '';

UPDATE leader_transfers
SET from_name_snapshot=COALESCE((SELECT name FROM users WHERE id=leader_transfers.from_user_id),''),
    to_name_snapshot=COALESCE((SELECT name FROM users WHERE id=leader_transfers.to_user_id),''),
    university_id_snapshot=COALESCE((SELECT university_id FROM teams WHERE id=leader_transfers.team_id),''),
    university_name_snapshot=COALESCE((
      SELECT u.canonical_name FROM teams t JOIN universities u ON u.id=t.university_id
      WHERE t.id=leader_transfers.team_id
    ),'');
