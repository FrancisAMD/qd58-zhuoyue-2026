import sqlite3
from pathlib import Path

migrations = sorted((Path(__file__).parents[1] / "migrations").glob("*.sql"))
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in migrations:
    db.executescript(migration.read_text(encoding="utf-8"))

university_columns = {row[1] for row in db.execute("PRAGMA table_info(universities)")}
assert {"category", "region_name", "education_level", "project_tags_json", "partner_name"} <= university_columns

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
db.execute("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status) VALUES(?,?,?,?,?)", ("reject-me","t1","u1","u2","pending"))
must_fail("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status) VALUES(?,?,?,?,?)", ("second-pending","t1","u1","u2","pending"))
db.execute("UPDATE leader_transfers SET status='rejected',responded_at='2026-11-12T01:00:00Z' WHERE id='reject-me'")
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t1'").fetchone()[0] == "u1"
must_fail("UPDATE leader_transfers SET status='accepted',responded_at='2026-11-12T01:01:00Z' WHERE id='reject-me'")

# Accepting a transfer atomically changes the leader; the new leader cannot leave the university.
db.execute("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status) VALUES(?,?,?,?,?)", ("accept-me","t1","u1","u2","pending"))
db.execute("UPDATE leader_transfers SET status='accepted',responded_at='2026-11-12T01:02:00Z' WHERE id='accept-me'")
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t1'").fetchone()[0] == "u2"
must_fail("UPDATE users SET university_id='uni2' WHERE id='u2'")

# A newly completed profile is assigned to a team only after membership is written.
db.execute("INSERT INTO users(id,phone,consent_at) VALUES(?,?,?)", ("u4","13800000004","2026-11-12T00:00:00Z"))
db.execute("UPDATE users SET university_id='uni2' WHERE id='u4'")
db.execute("INSERT OR IGNORE INTO teams(id,university_id,leader_user_id) SELECT 't2','uni2','u4' WHERE EXISTS(SELECT 1 FROM users WHERE id='u4' AND university_id='uni2')")
assert db.execute("SELECT leader_user_id FROM teams WHERE id='t2'").fetchone()[0] == "u4"

print("D1 schema tests: PASS (all migrations, privacy default, leader membership, transfer guards, pending uniqueness, reject/accept, atomic leader change).")
