#!/usr/bin/env python3
"""Offline replay of R2 account-deletion intents against a D1 SQL export.

This tool never connects to Cloudflare. It writes a verified, private SQL export
for an authorized operator to restore only into a disposable D1 rehearsal DB.
"""
import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path
from datetime import datetime

USER_ID = re.compile(r"^[a-f0-9]{32}$")
EVENT_ID = re.compile(r"^[a-f0-9]{32}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
DEFAULT_MIGRATION = "0014_university_catalog_import_staging.sql"
REQUIRED_USER_COLUMNS = {
    "id", "phone", "password_hash", "name", "high_school", "class_name",
    "university_id", "grade", "province", "city", "bio", "gender",
    "major_group", "major_discipline_code", "admission_category_id",
    "admission_type_id", "campus_id", "campus_name", "campus_tag",
    "secondary_phone", "wechat_id", "profile_review_status",
    "profile_review_submitted_at", "profile_reviewed_at",
    "overseas_university_name", "phone_visible_to_team", "consent_given",
    "consent_at", "consent_version", "account_consent_at",
    "account_consent_version", "deleted_at", "updated_at"
}
TOMBSTONE_NULL_FIELDS = {
    "password_hash", "name", "high_school", "class_name", "university_id",
    "grade", "province", "city", "bio", "secondary_phone", "wechat_id"
}
TOMBSTONE_EMPTY_FIELDS = {
    "major_group", "major_discipline_code", "admission_category_id",
    "admission_type_id", "campus_id", "campus_name", "campus_tag",
    "profile_review_submitted_at", "profile_reviewed_at",
    "overseas_university_name", "consent_at", "consent_version",
    "account_consent_at", "account_consent_version"
}

ROOT = Path(__file__).resolve().parents[1]
VERIFY_PATH = ROOT / "scripts" / "verify-d1-export.py"
spec = importlib.util.spec_from_file_location("verify_d1_export", VERIFY_PATH)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ReplayError(Exception):
    pass


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _parse_timestamp(value):
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise ReplayError("deletion_ledger_timestamp_invalid")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        raise ReplayError("deletion_ledger_timestamp_invalid") from None


def _reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ReplayError("json_duplicate_key")
        result[key] = value
    return result


def normalize_record(record):
    if not isinstance(record, dict) or set(record) != {
        "schemaVersion", "userId", "requestedAt", "eventId", "payloadSha256"
    }:
        raise ReplayError("deletion_ledger_record_invalid")
    if record.get("schemaVersion") != 1 or not USER_ID.fullmatch(str(record.get("userId", ""))) or \
       not EVENT_ID.fullmatch(str(record.get("eventId", ""))) or \
       not SHA256.fullmatch(str(record.get("payloadSha256", ""))):
        raise ReplayError("deletion_ledger_record_invalid")
    _parse_timestamp(record.get("requestedAt"))
    base = {
        "schemaVersion": 1, "userId": record["userId"],
        "requestedAt": record["requestedAt"], "eventId": record["eventId"]
    }
    if _sha(_json_bytes(base)).lower() != record["payloadSha256"]:
        raise ReplayError("deletion_ledger_record_checksum_mismatch")
    return {
        "schemaVersion": 1, "userId": record["userId"],
        "requestedAt": record["requestedAt"], "eventId": record["eventId"],
        "payloadSha256": record["payloadSha256"]
    }


def load_snapshot(path):
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ReplayError("deletion_ledger_snapshot_not_regular")
    if source.stat().st_size <= 0 or source.stat().st_size > 50 * 1024 * 1024:
        raise ReplayError("deletion_ledger_snapshot_size_invalid")
    try:
        snapshot = json.loads(source.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except ReplayError:
        raise
    except Exception:
        raise ReplayError("deletion_ledger_snapshot_json_invalid") from None
    if not isinstance(snapshot, dict) or set(snapshot) != {
        "schemaVersion", "complete", "pageCount", "recordCount", "snapshotSha256", "records"
    } or snapshot.get("schemaVersion") != 1 or snapshot.get("complete") is not True:
        raise ReplayError("deletion_ledger_snapshot_incomplete")
    if not isinstance(snapshot.get("pageCount"), int) or snapshot["pageCount"] < 1 or snapshot["pageCount"] > 1000:
        raise ReplayError("deletion_ledger_snapshot_page_count_invalid")
    records = snapshot.get("records")
    if not isinstance(records, list) or len(records) > 100000 or snapshot.get("recordCount") != len(records):
        raise ReplayError("deletion_ledger_snapshot_record_count_invalid")
    normalized = [normalize_record(record) for record in records]
    normalized.sort(key=lambda record: record["userId"])
    user_ids, event_ids = set(), set()
    for record in normalized:
        if record["userId"] in user_ids or record["eventId"] in event_ids:
            raise ReplayError("deletion_ledger_snapshot_duplicate")
        user_ids.add(record["userId"])
        event_ids.add(record["eventId"])
    digest = _sha(_json_bytes(normalized))
    if not SHA256.fullmatch(str(snapshot.get("snapshotSha256", ""))) or digest != snapshot["snapshotSha256"]:
        raise ReplayError("deletion_ledger_snapshot_checksum_mismatch")
    return normalized, digest


def _restore_sql(path):
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ReplayError("backup_file_not_regular")
    try:
        sql_text = source.read_text(encoding="utf-8-sig")
    except Exception:
        raise ReplayError("backup_not_utf8") from None
    if "\x00" in sql_text:
        raise ReplayError("backup_contains_nul")
    db = sqlite3.connect(":memory:")
    db.enable_load_extension(False)
    db.set_authorizer(verifier._authorizer)
    try:
        db.executescript(sql_text)
    except sqlite3.Error:
        db.close()
        raise ReplayError("backup_sql_restore_failed") from None
    finally:
        db.set_authorizer(None)
    db.execute("PRAGMA foreign_keys=ON")
    db.row_factory = sqlite3.Row
    db.commit()
    return db


def _check_schema(db):
    columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
    if not REQUIRED_USER_COLUMNS <= columns:
        raise ReplayError("replay_user_schema_incomplete")
    for table in ("sessions", "otp_challenges", "rate_limits", "leader_transfers", "audit_logs", "teams"):
        if table not in {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
            raise ReplayError("replay_required_table_missing")


def _validate_tombstone(row):
    if row["deleted_at"] == "" or row["phone"] != "deleted:" + row["id"] or row["password_hash"] is not None:
        raise ReplayError("replay_tombstone_inconsistent")
    for field in TOMBSTONE_NULL_FIELDS:
        if row[field] is not None:
            raise ReplayError("replay_tombstone_inconsistent")
    for field in TOMBSTONE_EMPTY_FIELDS:
        if row[field] != "":
            raise ReplayError("replay_tombstone_inconsistent")
    if int(row["phone_visible_to_team"] or 0) != 0 or int(row["consent_given"] or 0) != 0:
        raise ReplayError("replay_tombstone_inconsistent")
    if row["gender"] != "undisclosed":
        raise ReplayError("replay_tombstone_inconsistent")


def _audit_for_event(db, event_id, user_id):
    row = db.execute("SELECT action,target_id FROM audit_logs WHERE id=?", (event_id,)).fetchone()
    if row and (row["action"] != "account.deleted" or row["target_id"] != user_id):
        raise ReplayError("replay_audit_event_conflict")
    return row


def _leader_review(db, user_id):
    rows = db.execute(
        """SELECT t.id,COUNT(u.id) AS active_members
           FROM teams t LEFT JOIN users u
             ON u.university_id=t.university_id AND u.deleted_at=''
           WHERE t.leader_user_id=? GROUP BY t.id""",
        (user_id,),
    ).fetchall()
    if any(int(row["active_members"] or 0) > 1 for row in rows):
        raise ReplayError("replay_manual_review_team_leader")
    return rows


def _rate_limit_keys(secret, phone):
    scopes = ("sms:cooldown", "sms:phone", "login:phone")
    result = []
    for scope in scopes:
        message = (scope + "\0" + phone).encode("utf-8")
        digest = hmac.new(secret, message, hashlib.sha256).hexdigest()
        result.append("rl:v1:" + scope + ":" + digest)
    result.extend(("sms:cooldown:" + phone, "sms:phone:" + phone, "login:phone:" + phone))
    return result


def preflight(db, records):
    plans = []
    for record in records:
        row = db.execute("SELECT * FROM users WHERE id=?", (record["userId"],)).fetchone()
        if row is None:
            plans.append({"record": record, "state": "not_found"})
            continue
        existing_audit = _audit_for_event(db, record["eventId"], record["userId"])
        if row["deleted_at"] != "":
            _validate_tombstone(row)
            if existing_audit is None:
                raise ReplayError("replay_tombstone_audit_missing")
            plans.append({"record": record, "state": "already_deleted"})
            continue
        if existing_audit is not None:
            raise ReplayError("replay_audit_exists_for_active_user")
        if not isinstance(row["phone"], str) or not row["phone"] or row["phone"].startswith("deleted:"):
            raise ReplayError("replay_active_user_phone_invalid")
        _leader_review(db, record["userId"])
        plans.append({"record": record, "state": "active", "phone": row["phone"]})
    return plans


def apply_intents(db, records, rate_limit_secret):
    if not isinstance(rate_limit_secret, bytes) or len(rate_limit_secret) < 32:
        raise ReplayError("rate_limit_secret_invalid")
    _check_schema(db)
    plans = preflight(db, records)
    replayed, already_deleted, not_found = 0, 0, 0
    db.execute("BEGIN IMMEDIATE")
    try:
        for plan in plans:
            record = plan["record"]
            user_id = record["userId"]
            if plan["state"] == "not_found":
                not_found += 1
                continue
            if plan["state"] == "already_deleted":
                already_deleted += 1
                continue
            phone = plan["phone"]
            requested_at = record["requestedAt"]
            keys = _rate_limit_keys(rate_limit_secret, phone)
            db.execute(
                "UPDATE leader_transfers SET status='expired',responded_at=? WHERE status='pending' AND (from_user_id=? OR to_user_id=?)",
                (requested_at, user_id, user_id),
            )
            db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            db.execute("DELETE FROM otp_challenges WHERE phone=?", (phone,))
            db.execute("DELETE FROM rate_limits WHERE bucket_key IN (" + ",".join("?" for _ in keys) + ")", keys)
            db.execute(
                """UPDATE teams SET leader_user_id=NULL
                   WHERE leader_user_id=? AND NOT EXISTS(
                     SELECT 1 FROM users member
                     WHERE member.university_id=teams.university_id
                       AND member.deleted_at='' AND member.id<>?)""",
                (user_id, user_id),
            )
            result = db.execute(
                """UPDATE users SET phone='deleted:'||id,password_hash=NULL,name=NULL,high_school=NULL,class_name=NULL,
                   university_id=NULL,grade=NULL,province=NULL,city=NULL,bio=NULL,gender='undisclosed',major_group='',
                   major_discipline_code='',admission_category_id='',admission_type_id='',campus_id='',campus_name='',
                   campus_tag='',secondary_phone='',wechat_id='',profile_review_status='rejected',
                   profile_review_submitted_at='',profile_reviewed_at='',overseas_university_name='',
                   phone_visible_to_team=0,consent_at='',consent_given=0,consent_version='',
                   account_consent_at='',account_consent_version='',deleted_at=?,updated_at=?
                   WHERE id=? AND deleted_at='' AND phone=?
                   AND NOT EXISTS(SELECT 1 FROM teams WHERE leader_user_id=users.id)
                   AND NOT EXISTS(SELECT 1 FROM leader_transfers WHERE status='pending'
                     AND (from_user_id=users.id OR to_user_id=users.id))""",
                (requested_at, requested_at, user_id, phone),
            )
            if result.rowcount != 1:
                raise ReplayError("replay_anonymization_conflict")
            metadata = json.dumps({"method":"restore_replay","eventId":record["eventId"]},ensure_ascii=False,separators=(",",":"))
            db.execute(
                "INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,'system',NULL,'account.deleted','user',?,?)",
                (record["eventId"], user_id, metadata),
            )
            replayed += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    for record in records:
        row = db.execute("SELECT * FROM users WHERE id=?", (record["userId"],)).fetchone()
        if row is not None and row["deleted_at"] != "":
            _validate_tombstone(row)
            audit = _audit_for_event(db, record["eventId"], record["userId"])
            if audit is None:
                raise ReplayError("replay_postcheck_audit_missing")
    return {"replayedCount":replayed,"alreadyDeletedCount":already_deleted,"notFoundCount":not_found}


def dump_database(db, path):
    target = Path(path)
    with target.open("w",encoding="utf-8",newline="\n") as file:
        for line in db.iterdump():
            file.write(line + "\n")


def replay_backup(sql_path, ledger_path, out_path, rate_limit_secret, expected_migration=DEFAULT_MIGRATION, private_dir=None):
    private_raw = Path(private_dir) if private_dir is not None else (ROOT / "private-backups")
    if private_raw.is_symlink():
        raise ReplayError("replay_private_directory_unsafe")
    private = private_raw.resolve()
    output_path = Path(out_path).resolve()
    if output_path.parent != private or output_path.exists() or output_path.is_symlink():
        raise ReplayError("replay_output_must_be_new_private_file")
    private.mkdir(parents=True,exist_ok=True)
    try:
        verifier.verify_sql_export(sql_path,expected_migration=expected_migration)
    except verifier.VerificationError as error:
        raise ReplayError(str(error)) from None
    records,snapshot_digest=load_snapshot(ledger_path)
    db=_restore_sql(sql_path)
    _check_schema(db)
    result=apply_intents(db,records,rate_limit_secret)
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode="w",encoding="utf-8",newline="\n",dir=private,prefix=".replay-",suffix=".sql",delete=False) as file:
            temporary=Path(file.name)
            for line in db.iterdump():
                file.write(line+"\n")
        try:
            verification=verifier.verify_sql_export(temporary,expected_migration=expected_migration)
        except verifier.VerificationError as error:
            raise ReplayError(str(error)) from None
        os.link(temporary,output_path)
        temporary.unlink()
        temporary=None
    finally:
        if temporary is not None:
            try: temporary.unlink()
            except OSError: pass
        db.close()
    return {
        "ok":True,"snapshotSha256":snapshot_digest,
        "replayedCount":result["replayedCount"],
        "alreadyDeletedCount":result["alreadyDeletedCount"],
        "notFoundCount":result["notFoundCount"],
        "integrityCheck":verification["integrityCheck"],
        "foreignKeyViolations":verification["foreignKeyViolations"],
        "deletedAccountTombstoneViolations":verification["deletedAccountTombstoneViolations"],
        "outputBytes":output_path.stat().st_size
    }


def main():
    parser=argparse.ArgumentParser(description="Reconcile external R2 deletion intents into a local D1 export.")
    parser.add_argument("--backup",required=True,help="Local SQL export from D1")
    parser.add_argument("--ledger",required=True,help="Complete deletion-intent snapshot JSON")
    parser.add_argument("--out",required=True,help="New SQL output file directly under private-backups")
    parser.add_argument("--expected-migration",default=DEFAULT_MIGRATION)
    args=parser.parse_args()
    secret=os.environ.get("RATE_LIMIT_HMAC_SECRET","")
    output=Path(args.out)
    if not output.is_absolute():
        output=(ROOT/output).resolve()
    try:
        result=replay_backup(args.backup,args.ledger,output,secret.encode("utf-8"),
            expected_migration=args.expected_migration,private_dir=ROOT/"private-backups")
        print(json.dumps(result,ensure_ascii=False,sort_keys=True))
    except ReplayError as error:
        print(json.dumps({"ok":False,"error":str(error)},ensure_ascii=False))
        return 1
    except Exception:
        print(json.dumps({"ok":False,"error":"replay_unexpected_failure"},ensure_ascii=False))
        return 1
    return 0


if __name__=="__main__":
    sys.exit(main())
