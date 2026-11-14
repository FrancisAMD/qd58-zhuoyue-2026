-- Ensure an account.deleted audit row can only be committed after its user tombstone.
-- D1 batch is transactional: if the guarded audit insert fails, all earlier cleanup
-- statements in the same batch are rolled back instead of leaving a half-deleted account.
CREATE TRIGGER IF NOT EXISTS account_deleted_audit_requires_tombstone
BEFORE INSERT ON audit_logs
WHEN NEW.action='account.deleted'
 AND (
   COALESCE(NEW.target_type,'') <> 'user'
   OR NOT EXISTS (
     SELECT 1 FROM users
     WHERE id=NEW.target_id AND deleted_at<>''
   )
 )
BEGIN
  SELECT RAISE(ABORT,'account_delete_conflict');
END;
