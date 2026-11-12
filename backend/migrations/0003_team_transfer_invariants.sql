-- Team membership and leader-transfer invariants.
CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leader_user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_team_created ON leader_transfers(team_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS teams_leader_insert_membership
BEFORE INSERT ON teams
WHEN NEW.leader_user_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.leader_user_id AND university_id=NEW.university_id)
BEGIN SELECT RAISE(ABORT,'team_leader_must_be_member'); END;

CREATE TRIGGER IF NOT EXISTS teams_leader_update_membership
BEFORE UPDATE OF leader_user_id, university_id ON teams
WHEN NEW.leader_user_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.leader_user_id AND university_id=NEW.university_id)
BEGIN SELECT RAISE(ABORT,'team_leader_must_be_member'); END;

CREATE TRIGGER IF NOT EXISTS users_cannot_leave_led_team
BEFORE UPDATE OF university_id ON users
WHEN OLD.university_id IS NOT NEW.university_id
 AND EXISTS (SELECT 1 FROM teams WHERE leader_user_id=OLD.id AND university_id=OLD.university_id)
BEGIN SELECT RAISE(ABORT,'leader_must_transfer_team_first'); END;

CREATE TRIGGER IF NOT EXISTS leader_transfer_insert_guard
BEFORE INSERT ON leader_transfers
WHEN NEW.status <> 'pending'
 OR NEW.from_user_id = NEW.to_user_id
 OR NOT EXISTS (
   SELECT 1 FROM teams t
   JOIN users sender ON sender.id=NEW.from_user_id
   JOIN users recipient ON recipient.id=NEW.to_user_id
   WHERE t.id=NEW.team_id AND t.leader_user_id=NEW.from_user_id
     AND sender.university_id=t.university_id
     AND recipient.university_id=t.university_id
 )
BEGIN SELECT RAISE(ABORT,'invalid_team_transfer'); END;

CREATE TRIGGER IF NOT EXISTS leader_transfer_transition_guard
BEFORE UPDATE OF status ON leader_transfers
WHEN OLD.status <> 'pending'
 OR NEW.status NOT IN ('accepted','rejected','expired')
 OR NEW.id IS NOT OLD.id
 OR NEW.team_id IS NOT OLD.team_id
 OR NEW.from_user_id IS NOT OLD.from_user_id
 OR NEW.to_user_id IS NOT OLD.to_user_id
 OR (NEW.status IN ('accepted','rejected') AND NEW.responded_at IS NULL)
 OR (NEW.status IN ('accepted','rejected') AND NOT EXISTS (
   SELECT 1 FROM teams t WHERE t.id=NEW.team_id AND t.leader_user_id=NEW.from_user_id
 ))
 OR (NEW.status='accepted' AND NOT EXISTS (
   SELECT 1 FROM users recipient JOIN teams t ON t.id=NEW.team_id
   WHERE recipient.id=NEW.to_user_id AND recipient.university_id=t.university_id
 ))
BEGIN SELECT RAISE(ABORT,'invalid_team_transfer_transition'); END;

CREATE TRIGGER IF NOT EXISTS leader_transfer_apply_accept
AFTER UPDATE OF status ON leader_transfers
WHEN NEW.status='accepted'
BEGIN
  UPDATE teams SET leader_user_id=NEW.to_user_id
  WHERE id=NEW.team_id AND leader_user_id=NEW.from_user_id;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT,'team_leader_update_failed') END;
END;
