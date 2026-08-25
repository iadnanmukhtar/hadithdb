ALTER TABLE books
ADD COLUMN properties JSON DEFAULT NULL
COMMENT 'Rendering and other extensible book properties'
AFTER format;

UPDATE books
SET properties=JSON_SET(
  COALESCE(properties, JSON_OBJECT()),
  '$.rendering',
  JSON_OBJECT('footnotes', 'sm')
)
WHERE type IN ('tafsir', 'trans')
  AND JSON_EXTRACT(properties, '$.rendering.footnotes') IS NULL;

UPDATE books
SET properties=JSON_SET(
  COALESCE(properties, JSON_OBJECT()),
  '$.rendering',
  JSON_OBJECT('footnotes', 'lg')
)
WHERE alias IN ('dawat', 'ishraq', 'en-maududi', 'en-easy-tajwid', 'unal');
