import hashlib
import importlib.util
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "backend" / "migrations").glob("*.sql"))
VERIFY_PATH = ROOT / "scripts" / "verify-d1-export.py"
spec = importlib.util.spec_from_file_location("verify_d1_export", VERIFY_PATH)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def build_database():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for migration in MIGRATIONS:
        db.executescript(migration.read_text(encoding="utf-8"))
    db.execute(
        """CREATE TABLE d1_migrations (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             name TEXT NOT NULL,
             applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    db.executemany(
        "INSERT INTO d1_migrations(name) VALUES(?)",
        [(migration.name,) for migration in MIGRATIONS],
    )
    db.execute(
        "INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)",
        ("synthetic-university", "合成测试大学", "synthetic:university"),
    )
    db.execute(
        "INSERT INTO users(id,phone,consent_at,name,university_id) VALUES(?,?,?,?,?)",
        ("synthetic-user", "13800000000", "2026-11-25T00:00:00Z", "合成用户", "synthetic-university"),
    )
    db.execute(
        "INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)",
        ("synthetic-team", "synthetic-university", "synthetic-user"),
    )
    db.execute(
        "INSERT INTO users(id,phone,high_school,consent_at) VALUES(?,?,?,?)",
        ("deleted-user", "deleted:deleted-user", None, ""),
    )
    db.execute(
        "UPDATE users SET deleted_at=? WHERE id='deleted-user'",
        ("2026-11-25T00:00:00Z",),
    )
    db.execute(
        """INSERT INTO audit_logs(
             id,actor_type,actor_id,action,target_type,target_id,metadata_json
           ) VALUES(?, 'system', NULL, 'account.deleted', 'user', ?, '{}')""",
        ("synthetic-delete-audit", "deleted-user"),
    )
    db.commit()
    return db


def dump_database(db, path):
    path.write_text("\n".join(db.iterdump()) + "\n", encoding="utf-8")


def expect_error(path, code, **kwargs):
    try:
        verifier.verify_sql_export(path, **kwargs)
    except verifier.VerificationError as error:
        assert str(error) == code, (str(error), code)
        return
    raise AssertionError("expected verifier failure: " + code)


with tempfile.TemporaryDirectory(prefix="qd58-backup-smoke-") as temporary:
    directory = Path(temporary)
    valid_path = directory / "valid-export.sql"
    database = build_database()
    dump_database(database, valid_path)
    database.close()

    digest = hashlib.sha256(valid_path.read_bytes()).hexdigest()
    result = verifier.verify_sql_export(
        valid_path,
        expected_migration="0014_university_catalog_import_staging.sql",
        expected_sha256=digest,
    )
    assert result["ok"] is True
    assert result["integrityCheck"] == "ok"
    assert result["foreignKeyViolations"] == 0
    assert result["deletedAccountTombstoneViolations"] == 0

    expect_error(valid_path, "backup_sha256_mismatch", expected_sha256="0" * 64)
    expect_error(valid_path, "backup_expected_migration_missing", expected_migration="9999_missing.sql")

    malformed_path = directory / "malformed.sql"
    malformed_path.write_text("CREATE TABLE broken (", encoding="utf-8")
    expect_error(malformed_path, "backup_sql_restore_failed")

    attach_path = directory / "attach-not-allowed.sql"
    attach_path.write_text("ATTACH DATABASE ':memory:' AS external_db;", encoding="utf-8")
    expect_error(attach_path, "backup_sql_restore_failed")

    pragma_path = directory / "writable-schema-not-allowed.sql"
    pragma_path.write_text("PRAGMA writable_schema=ON;", encoding="utf-8")
    expect_error(pragma_path, "backup_sql_restore_failed")

    extension_path = directory / "extension-not-allowed.sql"
    extension_path.write_text("SELECT load_extension('not-a-real-extension');", encoding="utf-8")
    expect_error(extension_path, "backup_sql_restore_failed")

    fk_db = sqlite3.connect(":memory:")
    fk_db.executescript(valid_path.read_text(encoding="utf-8"))
    fk_db.execute("PRAGMA foreign_keys=OFF")
    fk_db.execute(
        "INSERT INTO users(id,phone,consent_at,university_id) VALUES(?,?,?,?)",
        ("orphan-user", "13800000001", "2026-11-25T00:00:00Z", "missing-university"),
    )
    fk_path = directory / "foreign-key-invalid.sql"
    dump_database(fk_db, fk_path)
    fk_db.close()
    expect_error(fk_path, "backup_foreign_key_check_failed")

    tombstone_db = sqlite3.connect(":memory:")
    tombstone_db.executescript(valid_path.read_text(encoding="utf-8"))
    tombstone_db.execute("DROP TRIGGER users_delete_requires_anonymized_fields")
    tombstone_db.execute(
        "INSERT INTO users(id,phone,consent_at,name) VALUES(?,?,?,?)",
        ("bad-tombstone", "13800000002", "2026-11-25T00:00:00Z", "不应保留的姓名"),
    )
    tombstone_db.execute("UPDATE users SET greeting=? WHERE id='bad-tombstone'",("不应保留的问候",))
    tombstone_db.execute(
        "UPDATE users SET deleted_at=? WHERE id='bad-tombstone'",
        ("2026-11-25T00:00:00Z",),
    )
    tombstone_path = directory / "tombstone-invalid.sql"
    dump_database(tombstone_db, tombstone_path)
    tombstone_db.close()
    expect_error(tombstone_path, "backup_deleted_account_pii_present")

    missing_table_db = sqlite3.connect(":memory:")
    missing_table_db.executescript(valid_path.read_text(encoding="utf-8"))
    missing_table_db.execute("DROP TABLE admin_sessions")
    missing_table_path = directory / "missing-table.sql"
    dump_database(missing_table_db, missing_table_path)
    missing_table_db.close()
    expect_error(missing_table_path, "backup_missing_required_tables")

print("D1 backup export restore-verification tests: PASS (synthetic migrations, integrity, FKs, tombstone privacy, schema and checksum).")
