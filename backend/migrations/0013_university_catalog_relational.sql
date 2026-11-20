-- Additive university-catalog schema. Existing universities.id values and all
-- users/teams foreign keys remain unchanged. Legacy rows keep catalog_id=NULL;
-- the catalog importer/API must only expose records with catalog_id IS NOT NULL.
--
-- Legacy columns (canonical_name, normalized_name, category, region_name,
-- education_level, project_tags_json, partner_name) remain for compatibility
-- with the current Worker until the catalog-backed profile API is deployed.

ALTER TABLE universities ADD COLUMN catalog_id TEXT;
ALTER TABLE universities ADD COLUMN catalog_normalized_name TEXT;
ALTER TABLE universities ADD COLUMN official_school_code TEXT;
ALTER TABLE universities ADD COLUMN name_en TEXT;
ALTER TABLE universities ADD COLUMN country_code TEXT;
ALTER TABLE universities ADD COLUMN country_name_zh TEXT;
ALTER TABLE universities ADD COLUMN country_name_en TEXT;
ALTER TABLE universities ADD COLUMN province_code TEXT;
ALTER TABLE universities ADD COLUMN province_name_zh TEXT;
ALTER TABLE universities ADD COLUMN city_name_zh TEXT;
ALTER TABLE universities ADD COLUMN degree_levels_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(degree_levels_json) AND json_type(degree_levels_json)='array');
ALTER TABLE universities ADD COLUMN ownership TEXT NOT NULL DEFAULT 'unknown'
  CHECK (ownership IN ('public','private','cooperative','other','unknown'));
ALTER TABLE universities ADD COLUMN campus_structure TEXT NOT NULL DEFAULT 'unknown'
  CHECK (campus_structure IN ('single','multiple','unknown'));
ALTER TABLE universities ADD COLUMN has_branch_campus INTEGER
  CHECK (has_branch_campus IN (0,1) OR has_branch_campus IS NULL);
ALTER TABLE universities ADD COLUMN campus_info_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (campus_info_status IN ('complete','partial','not_collected','unknown'));
ALTER TABLE universities ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (verification_status IN ('draft','needs_review','verified'));
ALTER TABLE universities ADD COLUMN verified_at TEXT;
ALTER TABLE universities ADD COLUMN verified_fields_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(verified_fields_json) AND json_type(verified_fields_json)='array');
ALTER TABLE universities ADD COLUMN verification_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE universities ADD COLUMN catalog_status TEXT NOT NULL DEFAULT 'active'
  CHECK (catalog_status IN ('active','inactive','merged'));
ALTER TABLE universities ADD COLUMN merged_into TEXT REFERENCES universities(id);
ALTER TABLE universities ADD COLUMN catalog_dataset_version TEXT;
ALTER TABLE universities ADD COLUMN catalog_updated_at TEXT;
ALTER TABLE universities ADD COLUMN catalog_source_count INTEGER NOT NULL DEFAULT 0
  CHECK (catalog_source_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_universities_catalog_id
  ON universities(catalog_id) WHERE catalog_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_universities_catalog_normalized_name
  ON universities(catalog_normalized_name) WHERE catalog_normalized_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_universities_catalog_school_code
  ON universities(official_school_code) WHERE official_school_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_universities_catalog_category_status
  ON universities(category,catalog_status,canonical_name) WHERE catalog_id IS NOT NULL;

-- The normalized name is country-aware and separate from the legacy normalized_name
-- column, whose uniqueness semantics predate the international catalog.
CREATE TRIGGER IF NOT EXISTS university_catalog_identity_insert_guard
BEFORE INSERT ON universities
WHEN NEW.catalog_id IS NOT NULL
 AND (
   NEW.category NOT IN ('mainland','hmt','overseas')
   OR NEW.catalog_normalized_name IS NULL
   OR length(trim(NEW.catalog_normalized_name))=0
 )
BEGIN
  SELECT RAISE(ABORT,'invalid_university_catalog_identity');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_identity_update_guard
BEFORE UPDATE OF catalog_id,catalog_normalized_name,category ON universities
WHEN NEW.catalog_id IS NOT NULL
 AND (
   NEW.category NOT IN ('mainland','hmt','overseas')
   OR NEW.catalog_normalized_name IS NULL
   OR length(trim(NEW.catalog_normalized_name))=0
 )
BEGIN
  SELECT RAISE(ABORT,'invalid_university_catalog_identity');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_merge_insert_guard
BEFORE INSERT ON universities
WHEN NEW.catalog_id IS NOT NULL
 AND (
   (NEW.catalog_status='merged' AND (NEW.merged_into IS NULL OR NEW.merged_into=NEW.id))
   OR (NEW.catalog_status<>'merged' AND NEW.merged_into IS NOT NULL)
 )
BEGIN
  SELECT RAISE(ABORT,'invalid_university_catalog_merge');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_merge_update_guard
BEFORE UPDATE OF catalog_status,merged_into ON universities
WHEN NEW.catalog_id IS NOT NULL
 AND (
   (NEW.catalog_status='merged' AND (NEW.merged_into IS NULL OR NEW.merged_into=NEW.id))
   OR (NEW.catalog_status<>'merged' AND NEW.merged_into IS NOT NULL)
 )
BEGIN
  SELECT RAISE(ABORT,'invalid_university_catalog_merge');
END;

CREATE TABLE IF NOT EXISTS university_aliases (
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (length(trim(alias))>0),
  normalized_alias TEXT NOT NULL CHECK (length(trim(normalized_alias))>0),
  PRIMARY KEY (university_id,normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_university_aliases_normalized
  ON university_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS university_tags (
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  tag_group TEXT NOT NULL
    CHECK (tag_group IN ('degree_level','school_type','project','double_first_class_discipline')),
  tag_code TEXT NOT NULL CHECK (length(trim(tag_code))>0),
  PRIMARY KEY (university_id,tag_group,tag_code)
);
CREATE INDEX IF NOT EXISTS idx_university_tags_lookup
  ON university_tags(tag_group,tag_code,university_id);

CREATE TABLE IF NOT EXISTS university_campuses (
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  campus_key TEXT NOT NULL CHECK (length(trim(campus_key))>0),
  name_zh TEXT,
  name_en TEXT,
  is_main_campus INTEGER NOT NULL CHECK (is_main_campus IN (0,1)),
  is_branch_campus INTEGER CHECK (is_branch_campus IN (0,1) OR is_branch_campus IS NULL),
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name_zh TEXT NOT NULL CHECK (length(trim(country_name_zh))>0),
  country_name_en TEXT,
  province_code TEXT,
  province_name_zh TEXT,
  city_name_zh TEXT,
  PRIMARY KEY (university_id,campus_key),
  CHECK (
    (name_zh IS NOT NULL AND length(trim(name_zh))>0)
    OR (name_en IS NOT NULL AND length(trim(name_en))>0)
  ),
  CHECK (NOT (is_main_campus=1 AND is_branch_campus=1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_university_one_main_campus
  ON university_campuses(university_id) WHERE is_main_campus=1;
CREATE INDEX IF NOT EXISTS idx_university_campuses_name
  ON university_campuses(university_id,name_zh);

CREATE TABLE IF NOT EXISTS university_sources (
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('government','education_authority','institution','other')),
  publisher TEXT NOT NULL CHECK (length(trim(publisher))>0),
  title TEXT NOT NULL CHECK (length(trim(title))>0),
  url TEXT NOT NULL CHECK (substr(url,1,8)='https://'),
  accessed_at TEXT NOT NULL,
  supports_fields_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(supports_fields_json) AND json_type(supports_fields_json)='array'),
  PRIMARY KEY (university_id,url)
);
CREATE INDEX IF NOT EXISTS idx_university_sources_accessed
  ON university_sources(university_id,accessed_at DESC);

CREATE TABLE IF NOT EXISTS university_catalog_imports (
  dataset_version TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL
    CHECK (length(checksum_sha256)=64 AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'),
  imported_at TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count>=0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count>=0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count>=0),
  linked_existing_count INTEGER NOT NULL DEFAULT 0 CHECK (linked_existing_count>=0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count>=0),
  status TEXT NOT NULL CHECK (status IN ('validated','applied','failed')),
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_university_catalog_imports_imported
  ON university_catalog_imports(imported_at DESC);
