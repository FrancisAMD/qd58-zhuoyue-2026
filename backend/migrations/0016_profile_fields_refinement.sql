-- Refine the student-facing profile form:
-- 1) replace the legacy profile bio field with a short greeting;
-- 2) stop collecting high-school class names;
-- 3) retain old greeting text when it exists, but clear the obsolete source column.
ALTER TABLE users ADD COLUMN greeting TEXT NOT NULL DEFAULT '';

UPDATE users
SET greeting = substr(trim(COALESCE(NULLIF(greeting,''), bio, '')), 1, 500)
WHERE trim(COALESCE(greeting,'')) <> '' OR trim(COALESCE(bio,'')) <> '';

UPDATE users SET bio=NULL WHERE bio IS NOT NULL;
UPDATE users SET class_name='' WHERE class_name IS NOT NULL AND class_name<>'';
