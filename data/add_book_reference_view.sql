UPDATE books
SET properties=JSON_SET(
  COALESCE(properties, JSON_OBJECT()),
  '$.reader.referenceView',
  'section'
)
WHERE alias='ibnhisham';
