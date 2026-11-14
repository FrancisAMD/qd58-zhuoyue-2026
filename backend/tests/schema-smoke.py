import sqlite3
from pathlib import Path

migrations = sorted((Path(__file__).parents[1] / "migrations").glob("*.sql"))
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in migrations:
    if migration.name == "0005_explicit_consent.sql":
        db.execute("INSERT INTO users(id,phone,consent_at) VALUES(?,?,?)", ("legacy-consent","13800000099","2026-11-11T00:00:00Z"))
    db.executescript(migration.read_text(encoding="utf-8"))

assert db.execute("SELECT consent_given,consent_at,consent_version,account_consent_at,account_consent_version FROM users WHERE id=?", ("legacy-consent",)).fetchone() == (0, "", "", "", "")

university_columns = {row[1] for row in db.execute("PRAGMA table_info(universities)")}
assert {"category", "region_name", "education_level", "project_tags_json", "partner_name"} <= university_columns
user_columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
assert {"consent_given", "consent_version", "account_consent_at", "account_consent_version"} <= user_columns
transfer_columns = {row[1] for row in db.execute("PRAGMA table_info(leader_transfers)")}
assert "expires_at" in transfer_columns

def must_fail(sql, params=()):
    try:
        db.execute(sql, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"Expected constraint failure: {sql}")

db.execute("INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)", ("uni1","北京大学","北京大学"))
db.execute("INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)", ("uni2","清华大学","清华大学"))
db.execute("UPDATE universities SET category='mainland',education_level='undergraduate',project_tags_json='[\"985\",\"211\",\"double_first_class\"]' WHERE id='uni1'")
assert db.execute("SELECT category,education_level,project_tags_json FROM universities WHERE id='uni1'").fetchone() == ("mainland","undergraduate",'["985","211","double_first_class"]')
db.execute("INSERT INTO universities(id,canonical_name,normalized_name,category,region_name) VALUES(?,?,?,?,?)", ("uni3","香港大学","hmt:香港大学","hmt","香港"))

db.execute("INSERT INTO users(id,phone,consent_at,university_id) VALUES(?,?,?,?)", ("u1","13800000000","2026-11-12T00:00:00Z","uni1"))
db.execute("INSERT INTO users(id,phone,consent_at,university_id) VALUES(?,?,?,?)", ("u2","13800000001","2026-11-12T00:00:00Z","uni1"))
db.execute("INSERT INTO users(id,phone,consent_at,university_id) VALUES(?,?,?,?)", ("u3","13800000002","2026-11-12T00:00:00Z","uni2"))
assert db.execute("SELECT phone_visible_to_team FROM users WHERE id='u1'").fetchone()[0] == 0
db.execute("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)", ("t1","uni1","u1"))
must_fail("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)", ("bad-team","uni1","u3"))

# A non-leader cannot create a transfer; only a current leader can target a same-team member.
must_fail("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status) VALUES(?,?,?,?,?)", ("bad-transfer","t1","u2","u1","pending"))
db.execute("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status,expires_at) VALUES(?,?,?,?,?,?)", ("reject-me","t1","u1","u2","pending","2099-01-01T00:00:00.000Z"))
must_fail("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status) VALUES(?,?,?,?,?)", ("second-pending","t1","u1","u2","pending"))
db.execute("UPDATE leader_transfers SET status='rejected',responded_at='2026-11-12T01:00:00Z' WHERE id='reject-me'")
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t1'").fetchone()[0] == "u1"
must_fail("UPDATE leader_transfers SET status='accepted',responded_at='2026-11-12T01:01:00Z' WHERE id='reject-me'")

# Accepting a transfer atomically changes the leader; the new leader cannot leave the university.
db.execute("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status,expires_at) VALUES(?,?,?,?,?,?)", ("accept-me","t1","u1","u2","pending","2099-01-01T00:00:00.000Z"))
db.execute("UPDATE leader_transfers SET status='accepted',responded_at='2026-11-12T01:02:00Z' WHERE id='accept-me'")
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t1'").fetchone()[0] == "u2"
must_fail("UPDATE users SET university_id='uni2' WHERE id='u2'")

# A pending transfer past its deadline transitions to expired and cannot later be accepted.
db.execute("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
           ("expired-me","t1","u2","u1","pending","2026-11-01T00:00:00.000Z","2026-11-02T00:00:00.000Z"))
db.execute("UPDATE leader_transfers SET status='expired',responded_at=? WHERE id=? AND status='pending' AND expires_at<=?",
           ("2026-11-03T00:00:00.000Z","expired-me","2026-11-03T00:00:00.000Z"))
must_fail("UPDATE leader_transfers SET status='accepted',responded_at='2026-11-03T00:00:00.000Z' WHERE id='expired-me'")
db.execute("UPDATE leader_transfers SET status='expired',responded_at=? WHERE id=? AND status='pending' AND expires_at<=?",
           ("2026-11-03T00:00:00.000Z","expired-me","2026-11-03T00:00:00.000Z"))
assert db.execute("SELECT status FROM leader_transfers WHERE id='expired-me'").fetchone()[0] == "expired"
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t1'").fetchone()[0] == "u2"
must_fail("UPDATE leader_transfers SET status='accepted',responded_at='2026-11-03T00:01:00.000Z' WHERE id='expired-me'")

# A newly completed profile is assigned to a team only after membership is written.
db.execute("INSERT INTO users(id,phone,consent_at) VALUES(?,?,?)", ("u4","13800000004","2026-11-12T00:00:00Z"))
db.execute("UPDATE users SET university_id='uni2' WHERE id='u4'")
db.execute("INSERT OR IGNORE INTO teams(id,university_id,leader_user_id) SELECT 't2','uni2','u4' WHERE EXISTS(SELECT 1 FROM users WHERE id='u4' AND university_id='uni2')")
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t2'").fetchone()[0] == "u4"


# Administrator identities are case-insensitive and preserve one active owner.
db.execute("INSERT INTO admin_users(id,username,password_hash,role,active,updated_at) VALUES(?,?,?,?,1,?)",
           ("admin-owner","RootOps","hash","owner","2026-11-13T00:00:00Z"))
db.execute("INSERT INTO admin_users(id,username,password_hash,role,active,updated_at,created_by) VALUES(?,?,?,?,1,?,?)",
           ("admin-viewer","readOnly","hash","viewer","2026-11-13T00:00:00Z","admin-owner"))
must_fail("INSERT INTO admin_users(id,username,password_hash,role) VALUES(?,?,?,?)",
          ("admin-duplicate","READONLY","hash","viewer"))
must_fail("UPDATE admin_users SET role='admin' WHERE id='admin-owner'")
must_fail("UPDATE admin_users SET active=0 WHERE id='admin-owner'")
db.execute("INSERT INTO admin_users(id,username,password_hash,role,active) VALUES(?,?,?,?,1)",
           ("admin-owner2","SecondRoot","hash","owner"))
db.execute("UPDATE admin_users SET role='admin' WHERE id='admin-owner'")
must_fail("DELETE FROM admin_users WHERE id='admin-owner2'")
assert db.execute("SELECT role,active FROM admin_users WHERE id='admin-owner2'").fetchone() == ("owner",1)

# Account anonymization keeps the historical row but removes direct profile/auth data.
db.execute("INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)", ("uni5","Deletion Test University","mainland:deletion-test"))
db.execute("INSERT INTO users(id,phone,password_hash,name,high_school,class_name,university_id,grade,province,city,bio,phone_visible_to_team,consent_at,consent_given,consent_version,account_consent_at,account_consent_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
           ("u-solo","test-phone","hash","Test User","School","Class","uni5","Freshman","Region","City","Note",1,"now",1,"v1","now","v1"))
db.execute("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)", ("t-solo","uni5","u-solo"))
must_fail("UPDATE users SET phone='deleted:'||id,password_hash=NULL,name=NULL,high_school=NULL,class_name=NULL,university_id=NULL,grade=NULL,province=NULL,city=NULL,bio=NULL,phone_visible_to_team=0,consent_at='',consent_given=0,consent_version='',account_consent_at='',account_consent_version='',deleted_at='2026-11-14T00:00:00Z' WHERE id='u-solo'")
db.execute("UPDATE teams SET leader_user_id=NULL WHERE id='t-solo'")
db.execute("UPDATE users SET phone='deleted:'||id,password_hash=NULL,name=NULL,high_school=NULL,class_name=NULL,university_id=NULL,grade=NULL,province=NULL,city=NULL,bio=NULL,phone_visible_to_team=0,consent_at='',consent_given=0,consent_version='',account_consent_at='',account_consent_version='',deleted_at='2026-11-14T00:00:00Z' WHERE id='u-solo'")
assert db.execute("SELECT phone,password_hash,name,university_id,phone_visible_to_team,consent_given,deleted_at FROM users WHERE id='u-solo'").fetchone() == ("deleted:u-solo",None,None,None,0,0,"2026-11-14T00:00:00Z")

# The account.deleted audit trigger is the final guard in the deletion D1 batch.
# If the guarded user update matched no row, the audit insert fails and D1 rolls back
# all earlier session/team/OTP cleanup statements in that same batch.
must_fail("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,?,?,?,?,?,?)",
          ("premature-delete-audit","system",None,"account.deleted","user","u1","{}"))
db.execute("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,?,?,?,?,?,?)",
           ("valid-delete-audit","system",None,"account.deleted","user","u-solo","{}"))
must_fail("UPDATE users SET name='restore' WHERE id='u-solo'")
must_fail("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)", ("bad-deleted-leader","uni5","u-solo"))
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t-solo'").fetchone()[0] is None

print("D1 schema tests: PASS (all migrations, consent defaults, team/transfer invariants, admin owner protection and account anonymization guards).")
