import sqlite3
from pathlib import Path

migrations = sorted((Path(__file__).parents[1] / "migrations").glob("*.sql"))
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in migrations:
    if migration.name == "0005_explicit_consent.sql":
        db.execute("INSERT INTO users(id,phone,consent_at) VALUES(?,?,?)", ("legacy-consent","13800000099","2026-11-11T00:00:00Z"))
    if migration.name == "0017_team_transfer_snapshots.sql":
        # Seed a historical transfer before the snapshot migration; names and school
        # must remain available even after the participating user profile is cleared.
        db.execute(
            "INSERT INTO users(id,phone,name,consent_at,university_id) VALUES(?,?,?,?,?)",
            ("legacy-transfer-recipient","13800000008","历史接收人","2026-11-27T00:00:00Z","legacy-sino-foreign"),
        )
        db.execute(
            "INSERT INTO leader_transfers(id,team_id,from_user_id,to_user_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
            ("legacy-transfer","legacy-catalog-team","legacy-catalog-user","legacy-transfer-recipient","pending",
             "2026-11-26T00:00:00Z","2026-12-03T00:00:00Z"),
        )
    if migration.name == "0013_university_catalog_relational.sql":
        # Prove the additive catalog migration preserves legacy IDs and memberships.
        db.execute(
            "INSERT INTO universities(id,canonical_name,normalized_name,category,region_name,education_level,partner_name) VALUES(?,?,?,?,?,?,?)",
            ("legacy-sino-foreign", "示例中外合作大学", "sino_foreign:示例中外合作大学", "sino_foreign", "上海", "undergraduate", "Partner University"),
        )
        db.execute(
            "INSERT INTO users(id,phone,consent_at,university_id) VALUES(?,?,?,?)",
            ("legacy-catalog-user", "13800000009", "2026-11-20T00:00:00Z", "legacy-sino-foreign"),
        )
        db.execute(
            "INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)",
            ("legacy-catalog-team", "legacy-sino-foreign", "legacy-catalog-user"),
        )
    db.executescript(migration.read_text(encoding="utf-8"))

assert db.execute("SELECT consent_given,consent_at,consent_version,account_consent_at,account_consent_version FROM users WHERE id=?", ("legacy-consent",)).fetchone() == (0, "", "", "", "")

university_columns = {row[1] for row in db.execute("PRAGMA table_info(universities)")}
assert {"category", "region_name", "education_level", "project_tags_json", "partner_name"} <= university_columns
catalog_columns = {
    "catalog_id", "catalog_normalized_name", "official_school_code", "name_en",
    "country_code", "country_name_zh", "country_name_en", "province_code",
    "province_name_zh", "city_name_zh", "degree_levels_json", "ownership",
    "campus_structure", "has_branch_campus", "campus_info_status",
    "verification_status", "verified_at", "verified_fields_json",
    "verification_notes", "catalog_status", "merged_into",
    "catalog_dataset_version", "catalog_updated_at", "catalog_source_count"
}
assert catalog_columns <= university_columns
catalog_tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"university_aliases", "university_tags", "university_campuses", "university_sources", "university_catalog_imports", "university_catalog_import_staging"} <= catalog_tables
catalog_indexes = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
assert {
    "idx_universities_catalog_id", "idx_universities_catalog_normalized_name",
    "idx_universities_catalog_school_code", "idx_universities_catalog_category_status",
    "idx_university_aliases_normalized", "idx_university_tags_lookup",
    "idx_university_one_main_campus", "idx_university_campuses_name",
    "idx_university_sources_accessed", "idx_university_catalog_imports_imported", "idx_university_catalog_staging_target"
} <= catalog_indexes

# Legacy universities and their user/team foreign keys are not rewritten by 0013.
legacy = db.execute(
    "SELECT category,partner_name,catalog_id,verification_status,catalog_status FROM universities WHERE id='legacy-sino-foreign'"
).fetchone()
assert legacy == ("sino_foreign", "Partner University", None, "draft", "active")
assert db.execute("SELECT university_id FROM users WHERE id='legacy-catalog-user'").fetchone()[0] == "legacy-sino-foreign"
assert db.execute("SELECT leader_user_id FROM teams WHERE id='legacy-catalog-team'").fetchone()[0] == "legacy-catalog-user"
user_columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
assert {"consent_given", "consent_version", "account_consent_at", "account_consent_version", "auth_version", "greeting", "greeting"} <= user_columns

profile_columns = {
    "gender", "major_group", "major_discipline_code", "admission_category_id",
    "admission_type_id", "campus_id", "campus_name", "campus_tag",
    "secondary_phone", "wechat_id", "profile_review_status",
    "overseas_university_name", "profile_review_submitted_at", "profile_reviewed_at"
}
assert profile_columns <= user_columns
profile_tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"profile_university_catalog", "profile_option_codes"} <= profile_tables
profile_option_columns = {row[1] for row in db.execute("PRAGMA table_info(profile_option_codes)")}
assert {"option_type", "code", "parent_code", "label", "is_active"} <= profile_option_columns
profile_catalog_columns = {row[1] for row in db.execute("PRAGMA table_info(profile_university_catalog)")}
assert {"source_id", "university_id", "category", "canonical_name", "region_name", "province_name",
        "city_name", "tags_json", "campuses_json", "source_name", "verified_at", "dataset_version"} <= profile_catalog_columns


session_columns = {row[1] for row in db.execute("PRAGMA table_info(sessions)")}
assert "auth_version" in session_columns
transfer_columns = {row[1] for row in db.execute("PRAGMA table_info(leader_transfers)")}
assert "expires_at" in transfer_columns
assert {"from_name_snapshot","to_name_snapshot","university_id_snapshot","university_name_snapshot"} <= transfer_columns
assert db.execute(
    "SELECT from_name_snapshot,to_name_snapshot,university_id_snapshot,university_name_snapshot FROM leader_transfers WHERE id='legacy-transfer'"
).fetchone() == ("历史组长","历史接收人","legacy-sino-foreign","示例中外合作大学")
otp_columns = {row[1] for row in db.execute("PRAGMA table_info(otp_challenges)")}
assert "superseded_at" in otp_columns
retention_indexes = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
assert {"idx_otp_expires_at", "idx_otp_consumed_at", "idx_sessions_expires_at", "idx_admin_sessions_expires_at", "idx_rate_limits_window_started_at", "idx_otp_active_phone_purpose"} <= retention_indexes

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

# University catalog relational schema constraints and foreign-key behavior.
db.execute(
    """INSERT INTO universities(
        id,canonical_name,normalized_name,category,catalog_id,catalog_normalized_name,
        official_school_code,name_en,country_code,country_name_zh,country_name_en,
        province_code,province_name_zh,city_name_zh,degree_levels_json,ownership,
        campus_structure,has_branch_campus,campus_info_status,verification_status,
        verified_at,verified_fields_json,verification_notes,catalog_status,
        catalog_dataset_version,catalog_updated_at,catalog_source_count
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
    (
        "mainland:CN-10001", "示例大学", "catalog:mainland:CN-10001", "mainland",
        "mainland:CN-10001", "mainland:CN:示例大学", "10001", "Example University",
        "CN", "中国", "China", "CN-37", "山东省", "青岛市", '["undergraduate"]',
        "public", "multiple", 1, "complete", "verified",
        "2026-11-20T00:00:00Z", '["name_zh","category","degree_levels","location"]',
        "测试核验记录", "active", "2026-11-20", "2026-11-20T00:00:00Z", 1
    ),
)
assert db.execute("SELECT catalog_id,catalog_normalized_name,category FROM universities WHERE id='mainland:CN-10001'").fetchone() == (
    "mainland:CN-10001", "mainland:CN:示例大学", "mainland"
)
must_fail(
    """INSERT INTO universities(id,canonical_name,normalized_name,category,catalog_id,catalog_normalized_name)
       VALUES(?,?,?,?,?,?)""",
    ("mainland:CN-10002", "另一所大学", "catalog:mainland:CN-10002", "mainland", "mainland:CN-10001", "mainland:CN:另一所大学"),
)
must_fail(
    """INSERT INTO universities(id,canonical_name,normalized_name,category,catalog_id,catalog_normalized_name)
       VALUES(?,?,?,?,?,?)""",
    ("bad-catalog-category", "非法分类", "catalog:bad", "sino_foreign", "mainland:CN-10003", "mainland:CN:非法分类"),
)
must_fail(
    "UPDATE universities SET degree_levels_json='not-json' WHERE id='mainland:CN-10001'"
)
must_fail(
    "UPDATE universities SET catalog_status='merged',merged_into=NULL WHERE id='mainland:CN-10001'"
)

db.execute(
    "INSERT INTO university_aliases(university_id,alias,normalized_alias) VALUES(?,?,?)",
    ("mainland:CN-10001", "示例大", "示例大"),
)
must_fail(
    "INSERT INTO university_aliases(university_id,alias,normalized_alias) VALUES(?,?,?)",
    ("mainland:CN-10001", "示例大学简称", "示例大"),
)
db.execute(
    "INSERT INTO university_tags(university_id,tag_group,tag_code) VALUES(?,?,?)",
    ("mainland:CN-10001", "project", "project_985_legacy"),
)
must_fail(
    "INSERT INTO university_tags(university_id,tag_group,tag_code) VALUES(?,?,?)",
    ("mainland:CN-10001", "invalid-group", "tag"),
)

db.execute(
    """INSERT INTO university_campuses(
        university_id,campus_key,name_zh,is_main_campus,is_branch_campus,
        country_code,country_name_zh,province_code,province_name_zh,city_name_zh
    ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "main", "主校区", 1, 0, "CN", "中国", "CN-37", "山东省", "青岛市"),
)
db.execute(
    """INSERT INTO university_campuses(
        university_id,campus_key,name_zh,is_main_campus,is_branch_campus,
        country_code,country_name_zh,province_code,province_name_zh,city_name_zh
    ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "branch", "分校区", 0, 1, "CN", "中国", "CN-37", "山东省", "青岛市"),
)
must_fail(
    """INSERT INTO university_campuses(
        university_id,campus_key,name_zh,is_main_campus,is_branch_campus,country_code,country_name_zh
    ) VALUES(?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "second-main", "另一个主校区", 1, 0, "CN", "中国"),
)
must_fail(
    """INSERT INTO university_campuses(
        university_id,campus_key,name_zh,is_main_campus,is_branch_campus,country_code,country_name_zh
    ) VALUES(?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "bad-main", "错误主校区", 1, 1, "CN", "中国"),
)

db.execute(
    """INSERT INTO university_sources(
        university_id,source_type,publisher,title,url,accessed_at,supports_fields_json
    ) VALUES(?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "education_authority", "示例教育主管部门", "高校名单",
     "https://example.edu.cn/list", "2026-11-20", '["name_zh","location"]'),
)
must_fail(
    """INSERT INTO university_sources(
        university_id,source_type,publisher,title,url,accessed_at,supports_fields_json
    ) VALUES(?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "education_authority", "示例教育主管部门", "错误来源",
     "http://example.edu.cn/list", "2026-11-20", "[]"),
)
must_fail(
    """INSERT INTO university_sources(
        university_id,source_type,publisher,title,url,accessed_at,supports_fields_json
    ) VALUES(?,?,?,?,?,?,?)""",
    ("mainland:CN-10001", "education_authority", "示例教育主管部门", "错误 JSON",
     "https://example.edu.cn/other", "2026-11-20", "not-json"),
)

db.execute(
    """INSERT INTO university_catalog_imports(
        dataset_version,checksum_sha256,imported_at,record_count,inserted_count,status
    ) VALUES(?,?,?,?,?,?)""",
    ("2026-11-20", "a" * 64, "2026-11-20T00:00:00Z", 1, 1, "applied"),
)
must_fail(
    """INSERT INTO university_catalog_imports(
        dataset_version,checksum_sha256,imported_at,record_count,status
    ) VALUES(?,?,?,?,?)""",
    ("2026-11-21", "bad-checksum", "2026-11-21T00:00:00Z", 0, "applied"),
)
assert db.execute("PRAGMA foreign_key_check").fetchall() == []


# Migration 0014: staged catalog writes stay invisible until the final guarded commit.
import json

import_columns = {row[1] for row in db.execute("PRAGMA table_info(university_catalog_imports)")}
assert "manifest_sha256" in import_columns
stage_columns = {row[1] for row in db.execute("PRAGMA table_info(university_catalog_import_staging)")}
assert {
    "dataset_version", "checksum_sha256", "catalog_id", "target_university_id",
    "action", "payload_json", "payload_sha256", "created_at"
} <= stage_columns
stage_triggers = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
assert {
    "university_catalog_staging_insert_guard",
    "university_catalog_staging_update_guard",
    "university_catalog_staging_delete_guard",
    "university_catalog_import_metadata_guard",
    "university_catalog_import_applied_immutable",
    "university_catalog_import_apply_guard"
} <= stage_triggers

def stage_test_batch(version, catalog_id, target_id, checksum, manifest_hash, record_count=1):
    db.execute(
        "INSERT INTO university_catalog_imports(dataset_version,checksum_sha256,manifest_sha256,imported_at,record_count,status) VALUES(?,?,?,?,?,'validated')",
        (version, checksum, manifest_hash, "2026-11-23T00:00:00Z", record_count),
    )
    payload = {
        "target_university_id": target_id,
        "catalog_normalized_name": "mainland:CN:" + catalog_id.split(":", 1)[1].replace("CN-", "").lower(),
        "merged_into_university_id": None,
        "record": {
            "id": catalog_id,
            "category": "mainland",
            "location": {"country_code": "CN"},
            "official_school_code": None,
            "status": "active",
        },
    }
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    db.execute(
        "INSERT INTO university_catalog_import_staging(dataset_version,checksum_sha256,catalog_id,target_university_id,action,payload_json,payload_sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (version, checksum, catalog_id, target_id, "insert", payload_text, "e" * 64, "2026-11-23T00:00:00Z"),
    )
    return payload

# A batch cannot be marked applied before every staged target is present and identical.
stage_test_batch("2026-11-23-writer", "mainland:CN-STAGED", "staged-new", "c" * 64, "d" * 64)
must_fail("UPDATE university_catalog_imports SET status='applied' WHERE dataset_version='2026-11-23-writer'")
must_fail("DELETE FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-writer'")
must_fail("UPDATE university_catalog_import_staging SET action='update' WHERE dataset_version='2026-11-23-writer'")
db.execute(
    "INSERT INTO universities(id,canonical_name,normalized_name,category,catalog_id,catalog_normalized_name,official_school_code,country_code,catalog_dataset_version,catalog_status) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ("staged-new", "暂存大学", "catalog:mainland:CN-STAGED", "mainland", "mainland:CN-STAGED",
     "mainland:CN:staged", None, "CN", "2026-11-23-writer", "active"),
)
db.execute(
    "UPDATE university_catalog_imports SET status='applied',inserted_count=1 WHERE dataset_version='2026-11-23-writer'"
)
assert db.execute("SELECT status FROM university_catalog_imports WHERE dataset_version='2026-11-23-writer'").fetchone()[0] == "applied"
db.execute("DELETE FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-writer'")
assert db.execute("SELECT COUNT(*) FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-writer'").fetchone()[0] == 0
must_fail(
    "INSERT INTO university_catalog_import_staging(dataset_version,checksum_sha256,catalog_id,target_university_id,action,payload_json,payload_sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ("2026-11-23-writer", "c" * 64, "mainland:CN-LATE", "late-row", "insert", "{}", "f" * 64, "now"),
)
must_fail("UPDATE university_catalog_imports SET status='validated' WHERE dataset_version='2026-11-23-writer'")

# A missing staged row prevents finalization.
stage_test_batch("2026-11-23-incomplete", "mainland:CN-INCOMPLETE", "incomplete-new", "a" * 64, "b" * 64, 2)
must_fail("UPDATE university_catalog_imports SET status='applied' WHERE dataset_version='2026-11-23-incomplete'")
db.execute("UPDATE university_catalog_imports SET status='failed' WHERE dataset_version='2026-11-23-incomplete'")
db.execute("DELETE FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-incomplete'")

# Two catalog IDs cannot map to one live D1 university row within the same batch.
stage_test_batch("2026-11-23-duplicate-target", "mainland:CN-DUPLICATE-A", "same-target", "9" * 64, "8" * 64, 2)
duplicate_payload = {
    "target_university_id": "same-target",
    "catalog_normalized_name": "mainland:CN:duplicate-b",
    "merged_into_university_id": None,
    "record": {
        "id": "mainland:CN-DUPLICATE-B",
        "category": "mainland",
        "location": {"country_code": "CN"},
        "official_school_code": None,
        "status": "active",
    },
}
must_fail(
    "INSERT INTO university_catalog_import_staging(dataset_version,checksum_sha256,catalog_id,target_university_id,action,payload_json,payload_sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ("2026-11-23-duplicate-target", "9" * 64, "mainland:CN-DUPLICATE-B", "same-target", "insert",
     json.dumps(duplicate_payload), "7" * 64, "now"),
)
db.execute("UPDATE university_catalog_imports SET status='failed' WHERE dataset_version='2026-11-23-duplicate-target'")
db.execute("DELETE FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-duplicate-target'")

# Simulate the final D1 batch: a late child-table constraint failure rolls back
# the university insert and status transition, leaving only retryable staging.
rollback_payload = stage_test_batch(
    "2026-11-23-rollback", "mainland:CN-ROLLBACK", "rollback-new", "6" * 64, "5" * 64
)
db.execute("SAVEPOINT catalog_import_atomicity_test")
try:
    db.execute(
        "INSERT INTO universities(id,canonical_name,normalized_name,category,catalog_id,catalog_normalized_name,official_school_code,country_code,catalog_dataset_version,catalog_status) VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("rollback-new", "回滚大学", "catalog:mainland:CN-ROLLBACK", "mainland", "mainland:CN-ROLLBACK",
         rollback_payload["catalog_normalized_name"], None, "CN", "2026-11-23-rollback", "active"),
    )
    db.execute("UPDATE university_catalog_imports SET status='applied' WHERE dataset_version='2026-11-23-rollback'")
    db.execute(
        "INSERT INTO university_tags(university_id,tag_group,tag_code) VALUES(?,?,?)",
        ("rollback-new", "invalid-group", "bad-tag"),
    )
    db.execute("RELEASE SAVEPOINT catalog_import_atomicity_test")
    raise AssertionError("Expected the simulated final batch to fail")
except sqlite3.IntegrityError:
    db.execute("ROLLBACK TO SAVEPOINT catalog_import_atomicity_test")
    db.execute("RELEASE SAVEPOINT catalog_import_atomicity_test")
assert db.execute("SELECT COUNT(*) FROM universities WHERE id='rollback-new'").fetchone()[0] == 0
assert db.execute("SELECT status FROM university_catalog_imports WHERE dataset_version='2026-11-23-rollback'").fetchone()[0] == "validated"
assert db.execute("SELECT COUNT(*) FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-rollback'").fetchone()[0] == 1
db.execute("UPDATE university_catalog_imports SET status='failed' WHERE dataset_version='2026-11-23-rollback'")
db.execute("DELETE FROM university_catalog_import_staging WHERE dataset_version='2026-11-23-rollback'")

print("D1 schema tests: PASS (all migrations, legacy compatibility, catalog constraints, team/transfer invariants, RBAC and account anonymization).")
