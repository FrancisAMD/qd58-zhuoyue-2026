-- Independent administrator accounts, lifecycle metadata and guardrails.
ALTER TABLE admin_users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_users ADD COLUMN last_login_at TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_users ADD COLUMN created_by TEXT REFERENCES admin_users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_username_nocase
  ON admin_users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_created
  ON audit_logs(actor_type, actor_id, created_at DESC);

-- Never allow an operation to remove the final active owner account.
CREATE TRIGGER IF NOT EXISTS admin_users_protect_last_owner_update
BEFORE UPDATE OF role, active ON admin_users
WHEN OLD.role='owner' AND OLD.active=1
 AND (NEW.role<>'owner' OR NEW.active=0)
 AND (SELECT COUNT(*) FROM admin_users WHERE role='owner' AND active=1) <= 1
BEGIN
  SELECT RAISE(ABORT,'cannot_remove_last_active_owner');
END;

CREATE TRIGGER IF NOT EXISTS admin_users_protect_last_owner_delete
BEFORE DELETE ON admin_users
WHEN OLD.role='owner' AND OLD.active=1
 AND (SELECT COUNT(*) FROM admin_users WHERE role='owner' AND active=1) <= 1
BEGIN
  SELECT RAISE(ABORT,'cannot_delete_last_active_owner');
END;
