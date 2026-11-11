import sqlite3
from pathlib import Path
schema=Path(__file__).parents[1]/'migrations'/'0001_initial.sql'
db=sqlite3.connect(':memory:')
db.executescript(schema.read_text())
db.execute("INSERT INTO users(id,phone,consent_at) VALUES(?,?,?)",('u0','13800000000','2026-11-11T00:00:00Z'))
db.execute("INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)",('uni1','北京大学','北京大学'))
db.execute("UPDATE users SET name=?,class_name=?,university_id=?,grade=?,province=? WHERE id=?",('测试同学','2026届1班','uni1','大一','北京','u0'))
db.execute("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)",('t1','uni1','u0'))
db.execute("INSERT INTO users(id,phone,consent_at,university_id) VALUES(?,?,?,?)",('u1','13800000001','2026-11-11T00:00:00Z','uni1'))
db.execute("INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status) VALUES(?,?,?,?,?)",('x1','t1','u0','u1','pending'))
assert db.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 2
assert db.execute("SELECT status FROM leader_transfers WHERE id='x1'").fetchone()[0] == 'pending'
print('D1 schema smoke tests: PASS (phone-first signup, profile completion, team, transfer).')
