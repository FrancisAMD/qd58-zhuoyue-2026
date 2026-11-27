#!/usr/bin/env python3
"""Verify a Wrangler D1 SQL export by restoring it into a disposable SQLite database.

This tool is local-only. It never connects to Cloudflare and never prints row values.
"""
import argparse
import hashlib
import json
import sqlite3
import sys
import tempfile
from pathlib import Path

REQUIRED_TABLES = {
    "users", "sessions", "otp_challenges", "teams", "leader_transfers",
    "admin_users", "admin_sessions", "audit_logs", "rate_limits",
    "universities", "university_aliases", "university_tags",
    "university_campuses", "university_sources",
    "university_catalog_imports", "university_catalog_import_staging",
}
DANGEROUS_PRAGMAS = {
    "writable_schema", "journal_mode", "locking_mode", "temp_store",
    "trusted_schema", "recursive_triggers", "query_only",
}


class VerificationError(Exception):
    pass


def _authorizer(action, arg1, arg2, database_name, trigger_name):
    denied = {
        getattr(sqlite3, "SQLITE_ATTACH", -1),
        getattr(sqlite3, "SQLITE_DETACH", -1),
        getattr(sqlite3, "SQLITE_CREATE_VTABLE", -1),
        getattr(sqlite3, "SQLITE_DROP_VTABLE", -1),
    }
    if action in denied:
        return sqlite3.SQLITE_DENY
    if action == getattr(sqlite3, "SQLITE_PRAGMA", -2):
        if str(arg1 or "").lower() in DANGEROUS_PRAGMAS:
            return sqlite3.SQLITE_DENY
    if action == getattr(sqlite3, "SQLITE_FUNCTION", -3):
        if str(arg2 or arg1 or "").lower() == "load_extension":
            return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def verify_sql_export(path, expected_migration=None, expected_sha256=None):
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise VerificationError("backup_file_not_regular")
    size = source.stat().st_size
    if size <= 0:
        raise VerificationError("backup_file_empty")
    if size > 1024 * 1024 * 1024:
        raise VerificationError("backup_file_over_1_gib")

    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 and digest != expected_sha256.lower():
        raise VerificationError("backup_sha256_mismatch")
    try:
        sql_text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise VerificationError("backup_not_utf8") from None
    if "\x00" in sql_text:
        raise VerificationError("backup_contains_nul")

    with tempfile.TemporaryDirectory(prefix="qd58-d1-restore-check-") as temporary:
        restored_path = Path(temporary) / "restore.sqlite3"
        db = sqlite3.connect(restored_path)
        try:
            db.enable_load_extension(False)
            db.set_authorizer(_authorizer)
            try:
                db.executescript(sql_text)
            except sqlite3.Error:
                raise VerificationError("backup_sql_restore_failed") from None
            finally:
                db.set_authorizer(None)

            db.execute("PRAGMA foreign_keys=ON")
            integrity = [row[0] for row in db.execute("PRAGMA integrity_check")]
            if integrity != ["ok"]:
                raise VerificationError("backup_integrity_check_failed")
            foreign_key_errors = db.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_key_errors:
                raise VerificationError("backup_foreign_key_check_failed")

            tables = {
                row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            missing = sorted(REQUIRED_TABLES - tables)
            if missing:
                raise VerificationError("backup_missing_required_tables")

            user_columns = {
                row[1] for row in db.execute("PRAGMA table_info(users)")
            }
            required_user_columns = {
                "deleted_at", "phone", "password_hash", "name", "high_school",
                "class_name", "university_id", "grade", "province", "city", "bio", "greeting",
                "phone_visible_to_team", "consent_given", "consent_at",
                "consent_version", "account_consent_at", "account_consent_version",
            }
            if not required_user_columns <= user_columns:
                raise VerificationError("backup_user_schema_incomplete")

            tombstone_violations = db.execute(
                """SELECT COUNT(*) FROM users
                   WHERE deleted_at<>'' AND (
                     phone NOT LIKE 'deleted:%'
                     OR password_hash IS NOT NULL
                     OR name IS NOT NULL
                     OR high_school IS NOT NULL
                     OR class_name IS NOT NULL
                     OR university_id IS NOT NULL
                     OR grade IS NOT NULL
                     OR province IS NOT NULL
                     OR city IS NOT NULL
                     OR bio IS NOT NULL
                     OR greeting IS NOT NULL
                     OR phone_visible_to_team<>0
                     OR consent_given<>0
                     OR consent_at<>''
                     OR consent_version<>''
                     OR account_consent_at<>''
                     OR account_consent_version<>''
                   )"""
            ).fetchone()[0]
            if tombstone_violations:
                raise VerificationError("backup_deleted_account_pii_present")

            if expected_migration:
                if "d1_migrations" not in tables:
                    raise VerificationError("backup_migration_history_missing")
                migration_columns = {
                    row[1] for row in db.execute("PRAGMA table_info(d1_migrations)")
                }
                if "name" not in migration_columns:
                    raise VerificationError("backup_migration_history_invalid")
                found = db.execute(
                    "SELECT 1 FROM d1_migrations WHERE name=? LIMIT 1",
                    (expected_migration,),
                ).fetchone()
                if not found:
                    raise VerificationError("backup_expected_migration_missing")
        finally:
            db.close()

    return {
        "ok": True,
        "sha256": digest,
        "bytes": size,
        "requiredTables": len(REQUIRED_TABLES),
        "integrityCheck": "ok",
        "foreignKeyViolations": 0,
        "deletedAccountTombstoneViolations": 0,
        "expectedMigration": expected_migration,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Restore a Wrangler D1 SQL export into temporary SQLite and verify integrity."
    )
    parser.add_argument("sql_export", help="Path to a local Wrangler D1 SQL export")
    parser.add_argument("--expected-migration", help="Required filename in d1_migrations, e.g. 0014_university_catalog_import_staging.sql")
    parser.add_argument("--sha256", help="Optional expected SHA-256 hex digest")
    args = parser.parse_args()
    try:
        result = verify_sql_export(
            args.sql_export,
            expected_migration=args.expected_migration,
            expected_sha256=args.sha256,
        )
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except VerificationError as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
