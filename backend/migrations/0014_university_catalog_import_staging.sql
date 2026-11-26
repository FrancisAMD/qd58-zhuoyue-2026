-- Transactional staging foundation for the university catalog writer.
-- Upload chunks are isolated in staging. The live catalog is changed only by one
-- final D1 batch; Cloudflare D1 batch() provides all-or-nothing transaction semantics.

ALTER TABLE university_catalog_imports ADD COLUMN manifest_sha256 TEXT
  CHECK (
    manifest_sha256 IS NULL
    OR (length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')
  );

CREATE TABLE IF NOT EXISTS university_catalog_import_staging (
  dataset_version TEXT NOT NULL REFERENCES university_catalog_imports(dataset_version) ON DELETE CASCADE,
  checksum_sha256 TEXT NOT NULL
    CHECK (length(checksum_sha256)=64 AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'),
  catalog_id TEXT NOT NULL CHECK (length(trim(catalog_id))>0),
  target_university_id TEXT NOT NULL CHECK (length(trim(target_university_id))>0),
  action TEXT NOT NULL CHECK (action IN ('insert','update','link_existing')),
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json)='object')
    CHECK (length(CAST(payload_json AS BLOB))<=1900000),
  payload_sha256 TEXT NOT NULL
    CHECK (length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (dataset_version,catalog_id),
  UNIQUE (dataset_version,target_university_id)
);

CREATE INDEX IF NOT EXISTS idx_university_catalog_staging_target
  ON university_catalog_import_staging(dataset_version,target_university_id);

CREATE TRIGGER IF NOT EXISTS university_catalog_staging_insert_guard
BEFORE INSERT ON university_catalog_import_staging
WHEN NOT EXISTS (
  SELECT 1 FROM university_catalog_imports i
  WHERE i.dataset_version=NEW.dataset_version
    AND i.checksum_sha256=NEW.checksum_sha256
    AND i.manifest_sha256 IS NOT NULL
    AND i.status='validated'
)
BEGIN
  SELECT RAISE(ABORT,'catalog_import_batch_not_stageable');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_staging_update_guard
BEFORE UPDATE ON university_catalog_import_staging
BEGIN
  SELECT RAISE(ABORT,'catalog_import_staging_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_staging_delete_guard
BEFORE DELETE ON university_catalog_import_staging
WHEN (SELECT status FROM university_catalog_imports WHERE dataset_version=OLD.dataset_version)
     NOT IN ('applied','failed')
BEGIN
  SELECT RAISE(ABORT,'catalog_import_staging_not_discardable');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_import_metadata_guard
BEFORE UPDATE OF checksum_sha256,manifest_sha256,record_count ON university_catalog_imports
WHEN EXISTS (
  SELECT 1 FROM university_catalog_import_staging s
  WHERE s.dataset_version=OLD.dataset_version
)
BEGIN
  SELECT RAISE(ABORT,'catalog_import_manifest_immutable_after_staging');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_import_applied_immutable
BEFORE UPDATE OF status ON university_catalog_imports
WHEN OLD.status='applied' AND NEW.status<>'applied'
BEGIN
  SELECT RAISE(ABORT,'catalog_import_applied_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS university_catalog_import_apply_guard
BEFORE UPDATE OF status ON university_catalog_imports
WHEN NEW.status='applied'
BEGIN
  SELECT CASE
    WHEN OLD.status<>'validated'
    THEN RAISE(ABORT,'catalog_import_not_validated')
  END;
  SELECT CASE
    WHEN NEW.manifest_sha256 IS NULL OR length(NEW.manifest_sha256)<>64
    THEN RAISE(ABORT,'catalog_import_manifest_missing')
  END;
  SELECT CASE
    WHEN NEW.record_count<=0
      OR (SELECT COUNT(*) FROM university_catalog_import_staging s
          WHERE s.dataset_version=NEW.dataset_version)<>NEW.record_count
    THEN RAISE(ABORT,'catalog_import_staging_incomplete')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM university_catalog_import_staging s
      LEFT JOIN universities u ON u.id=s.target_university_id
      WHERE s.dataset_version=NEW.dataset_version
        AND (
          u.id IS NULL
          OR u.catalog_id IS NOT s.catalog_id
          OR u.catalog_dataset_version IS NOT NEW.dataset_version
          OR u.category IS NOT json_extract(s.payload_json,'$.record.category')
          OR u.country_code IS NOT json_extract(s.payload_json,'$.record.location.country_code')
          OR u.catalog_normalized_name IS NOT json_extract(s.payload_json,'$.catalog_normalized_name')
          OR u.official_school_code IS NOT json_extract(s.payload_json,'$.record.official_school_code')
          OR u.catalog_status IS NOT json_extract(s.payload_json,'$.record.status')
          OR u.merged_into IS NOT json_extract(s.payload_json,'$.merged_into_university_id')
        )
    )
    THEN RAISE(ABORT,'catalog_import_live_identity_mismatch')
  END;
END;
