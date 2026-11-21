-- Read-only, university-only snapshot for the dry-run catalog planner.
-- Requires migration 0013_university_catalog_relational.sql.
-- Do not add users, phone numbers, sessions, OTPs, audit payloads, or team membership.
SELECT
  id,
  catalog_id,
  catalog_normalized_name,
  official_school_code,
  category,
  canonical_name,
  normalized_name,
  country_code
FROM universities
ORDER BY id;

SELECT dataset_version, checksum_sha256, status
FROM university_catalog_imports
ORDER BY dataset_version;
