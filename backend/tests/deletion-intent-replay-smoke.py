import hashlib
import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
REPLAY_PATH=ROOT/"scripts"/"replay-deletion-intents.py"
VERIFY_PATH=ROOT/"scripts"/"verify-d1-export.py"
spec=importlib.util.spec_from_file_location("replay_deletion_intents",REPLAY_PATH)
replay=importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
verify_spec=importlib.util.spec_from_file_location("verify_d1_export",VERIFY_PATH)
verifier=importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)
MIGRATIONS=sorted((ROOT/"backend"/"migrations").glob("*.sql"))
SECRET=b"recovery-test-rate-limit-secret-0123456789"


def build_database(extra_member=False):
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for migration in MIGRATIONS:
        db.executescript(migration.read_text(encoding="utf-8"))
    db.execute("""CREATE TABLE d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    db.executemany("INSERT INTO d1_migrations(name) VALUES(?)",[(m.name,) for m in MIGRATIONS])
    db.execute("INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)",
      ("synthetic-university","合成测试大学","synthetic:university"))
    uid="a"*32
    db.execute("INSERT INTO users(id,phone,consent_at,name,university_id) VALUES(?,?,?,?,?)",
      (uid,"13800000000","2026-11-27T01:00:00Z","合成用户","synthetic-university"))
    db.execute("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)",
      ("synthetic-team","synthetic-university",uid))
    db.execute("INSERT INTO users(id,phone,consent_at,name) VALUES(?,?,?,?)",
      ("b"*32,"13800000001","2026-11-27T01:00:00Z","合成接收者"))
    if extra_member:
        db.execute("INSERT INTO users(id,phone,consent_at,name,university_id) VALUES(?,?,?,?,?)",
          ("c"*32,"13800000002","2026-11-27T01:00:00Z","合成队员","synthetic-university"))
    db.commit()
    return db,uid


def insert_dynamic(db,table,values):
    info=db.execute("PRAGMA table_info("+table+")").fetchall()
    columns=[]
    data=[]
    for row in info:
        name=row[1], row[2], row[3], row[4], row[5]
        column,typ,notnull,default,pk=name
        if column in values:
            columns.append(column);data.append(values[column]);continue
        if notnull and default is None and not pk:
            if column.endswith("_at") or column in ("created_at","responded_at"):
                value=0 if "INT" in typ.upper() else ""
            elif column in ("attempts","hit_count","auth_version"):
                value=0
            elif column in ("status","purpose","actor_type","action","target_type"):
                value="pending" if column=="status" else "synthetic"
            elif column in ("phone","out_id"):
                value="synthetic"
            elif column.endswith("_hash") or column=="token_hash":
                value="f"*64
            else:
                value="synthetic"
            columns.append(column);data.append(value)
    sql="INSERT INTO "+table+"("+",".join(columns)+") VALUES("+",".join("?" for _ in columns)+")"
    db.execute(sql,data)


def record(user_id,event_id,requested_at):
    base={"schemaVersion":1,"userId":user_id,"requestedAt":requested_at,"eventId":event_id}
    digest=hashlib.sha256(json.dumps(base,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
    return {**base,"payloadSha256":digest}


def snapshot(records):
    records=sorted(records,key=lambda item:item["userId"])
    digest=hashlib.sha256(json.dumps(records,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
    return {"schemaVersion":1,"complete":True,"pageCount":1,"recordCount":len(records),
      "snapshotSha256":digest,"records":records}


def dump(db,path):
    path.write_text("\n".join(db.iterdump())+"\n",encoding="utf-8")


def expect_replay_error(code,func):
    try: func()
    except replay.ReplayError as error:
        assert str(error)==code,(str(error),code)
        return
    raise AssertionError("expected replay error "+code)


with tempfile.TemporaryDirectory(prefix="qd58-deletion-replay-smoke-") as temporary:
    directory=Path(temporary)
    db,uid=build_database()
    phone="13800000000"
    insert_dynamic(db,"sessions",{"token_hash":"d"*64,"user_id":uid,"expires_at":9999999999,"created_at":1764205200,"auth_version":1})
    insert_dynamic(db,"otp_challenges",{"id":"otp-replay-001","phone":phone,"code_hash":"e"*64,
      "expires_at":9999999999,"attempts":0,"consumed_at":None,"superseded_at":None,
      "created_at":1764205200,"purpose":"account_delete","out_id":"123456"})
    keys=replay._rate_limit_keys(SECRET,phone)
    for i,key in enumerate(keys):
        insert_dynamic(db,"rate_limits",{"bucket_key":key,"window_started_at":1764205200,"hit_count":1})
    insert_dynamic(db,"leader_transfers",{"id":"transfer-replay-001","team_id":"synthetic-team",
      "from_user_id":uid,"to_user_id":"b"*32,"status":"pending","created_at":"2026-11-27T01:00:00.000Z",
      "expires_at":"2026-11-28T01:00:00.000Z","responded_at":""})
    db.commit()
    backup=directory/"pre-delete-export.sql"
    dump(db,backup)
    db.close()

    intents=[record(uid,"1"*32,"2026-11-27T01:02:00.000Z"),
      record("f"*32,"2"*32,"2026-11-27T01:03:00.000Z")]
    ledger=directory/"snapshot.json"
    ledger.write_text(json.dumps(snapshot(intents),ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    private=directory/"private-backups"
    private.mkdir()
    out=private/"replayed.sql"
    result=replay.replay_backup(backup,ledger,out,SECRET,private_dir=private)
    assert result["ok"] is True and result["replayedCount"]==1 and result["notFoundCount"]==1
    assert result["foreignKeyViolations"]==0 and result["deletedAccountTombstoneViolations"]==0
    restored=sqlite3.connect(":memory:")
    restored.execute("PRAGMA foreign_keys=ON")
    restored.executescript(out.read_text(encoding="utf-8"))
    user=restored.execute("SELECT phone,password_hash,name,university_id,deleted_at,gender FROM users WHERE id=?",(uid,)).fetchone()
    assert user[0]=="deleted:"+uid and user[1] is None and user[2] is None and user[3] is None and user[4]!="" and user[5]=="undisclosed"
    assert restored.execute("SELECT leader_user_id FROM teams WHERE id='synthetic-team'").fetchone()[0] is None
    assert restored.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?",(uid,)).fetchone()[0]==0
    assert restored.execute("SELECT COUNT(*) FROM otp_challenges WHERE phone=?",(phone,)).fetchone()[0]==0
    assert restored.execute("SELECT COUNT(*) FROM rate_limits WHERE bucket_key IN ("+",".join("?" for _ in keys)+")",keys).fetchone()[0]==0
    assert restored.execute("SELECT status FROM leader_transfers WHERE id='transfer-replay-001'").fetchone()[0]=="expired"
    assert restored.execute("SELECT action,target_id FROM audit_logs WHERE id=?","1"*32).fetchone()==("account.deleted",uid)
    restored.close()

    out2=private/"replayed-again.sql"
    second=replay.replay_backup(out,ledger,out2,SECRET,private_dir=private)
    assert second["replayedCount"]==0 and second["alreadyDeletedCount"]==1 and second["notFoundCount"]==1

    bad=directory/"bad-snapshot.json"
    broken=snapshot(intents);broken["snapshotSha256"]="0"*64
    bad.write_text(json.dumps(broken),encoding="utf-8")
    expect_replay_error("deletion_ledger_snapshot_checksum_mismatch",lambda:replay.load_snapshot(bad))

    expect_replay_error("rate_limit_secret_invalid",lambda:replay.apply_intents(build_database()[0],intents,b"short"))

    manual_db,manual_uid=build_database(extra_member=True)
    manual_intent=record(manual_uid,"3"*32,"2026-11-27T01:04:00.000Z")
    expect_replay_error("replay_manual_review_team_leader",lambda:replay.preflight(manual_db,[manual_intent]))
    manual_db.close()

    duplicate=snapshot([record(uid,"4"*32,"2026-11-27T01:05:00.000Z"),record(uid,"5"*32,"2026-11-27T01:06:00.000Z")])
    duplicate_path=directory/"duplicate.json"
    duplicate_path.write_text(json.dumps(duplicate),encoding="utf-8")
    expect_replay_error("deletion_ledger_snapshot_duplicate",lambda:replay.load_snapshot(duplicate_path))

print("Deletion intent replay tests: PASS (checksum, atomic replay, privacy tombstone, sessions/OTP/rate limits/transfers, leader release, idempotency, missing users, fail-closed manual review).")
