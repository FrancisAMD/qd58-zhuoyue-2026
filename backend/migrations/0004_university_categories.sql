-- Four top-level university categories, with institution-level metadata.
-- Existing university identities are retained under an explicit unclassified namespace
-- until a member selects the correct category in the updated profile flow.
ALTER TABLE universities ADD COLUMN category TEXT NOT NULL DEFAULT 'unclassified'
  CHECK(category IN ('unclassified','mainland','hmt','sino_foreign','overseas'));
ALTER TABLE universities ADD COLUMN region_name TEXT NOT NULL DEFAULT '';
ALTER TABLE universities ADD COLUMN education_level TEXT NOT NULL DEFAULT ''
  CHECK(education_level IN ('','undergraduate','vocational'));
ALTER TABLE universities ADD COLUMN project_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE universities ADD COLUMN partner_name TEXT NOT NULL DEFAULT '';

UPDATE universities
SET normalized_name = 'unclassified:' || normalized_name;

CREATE INDEX IF NOT EXISTS idx_universities_category_name
  ON universities(category, normalized_name);
