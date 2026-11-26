-- Profile fields and source-data catalog for the 2026 return-to-school registration flow.
-- Original source JSON remains in data/profile-sources; this relational mirror is used
-- by the Worker to validate school/campus IDs and preserve one team per university.

ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'undisclosed'
  CHECK(gender IN ('male','female','undisclosed'));
ALTER TABLE users ADD COLUMN major_group TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN major_discipline_code TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN admission_category_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN admission_type_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN campus_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN campus_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN campus_tag TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN secondary_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN wechat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_review_status TEXT NOT NULL DEFAULT 'approved'
  CHECK(profile_review_status IN ('approved','pending','rejected'));
ALTER TABLE users ADD COLUMN overseas_university_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_review_submitted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_reviewed_at TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS profile_university_catalog (
  source_id TEXT PRIMARY KEY CHECK(length(trim(source_id))>0),
  university_id TEXT NOT NULL UNIQUE REFERENCES universities(id),
  category TEXT NOT NULL CHECK(category IN ('mainland','hmt')),
  canonical_name TEXT NOT NULL CHECK(length(trim(canonical_name))>0),
  region_name TEXT NOT NULL DEFAULT '',
  province_name TEXT NOT NULL DEFAULT '',
  city_name TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]'
    CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
  campuses_json TEXT NOT NULL DEFAULT '[]'
    CHECK(json_valid(campuses_json) AND json_type(campuses_json)='array'),
  source_name TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT '',
  dataset_version TEXT NOT NULL DEFAULT '2026-11-26'
);
CREATE INDEX IF NOT EXISTS idx_profile_university_catalog_name
  ON profile_university_catalog(category,canonical_name);
CREATE INDEX IF NOT EXISTS idx_profile_university_catalog_university
  ON profile_university_catalog(university_id);

CREATE TABLE IF NOT EXISTS profile_option_codes (
  option_type TEXT NOT NULL
    CHECK(option_type IN ('major_group','major_discipline','admission_category','admission_type')),
  code TEXT NOT NULL CHECK(length(trim(code))>0),
  parent_code TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL CHECK(length(trim(label))>0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  PRIMARY KEY(option_type,code)
);
CREATE INDEX IF NOT EXISTS idx_profile_option_codes_parent
  ON profile_option_codes(option_type,parent_code,is_active);
