-- Consolidate legacy book metadata columns into the unified books schema.
-- Run after the deployed code reads author, death, and title as canonical.

UPDATE books
SET author = author_ar
WHERE author_ar IS NOT NULL
  AND author_ar <> '';

UPDATE books
SET death = NULLIF(yearOfDeath, 0)
WHERE yearOfDeath IS NOT NULL
  AND yearOfDeath <> 0;

UPDATE books
SET title = name
WHERE name IS NOT NULL
  AND name <> '';

ALTER TABLE books
  DROP COLUMN author_ar,
  DROP COLUMN yearOfDeath,
  DROP COLUMN name;
