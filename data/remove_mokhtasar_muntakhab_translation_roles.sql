UPDATE hadiths_commentary AS commentary
JOIN books AS book ON book.id=commentary.bookId
SET commentary.text_en=TRIM(SUBSTRING_INDEX(
  commentary.text_en,
  CONCAT(CHAR(10), CHAR(10)),
  -1
))
WHERE book.alias='mokhtasar'
  AND book.type='tafsir'
  AND commentary.ayahFrom > 0;

UPDATE books
SET properties=JSON_REMOVE(
  COALESCE(properties, JSON_OBJECT()),
  '$.quran.display_as',
  '$.quran.translation_extract',
  '$.quran.translation_split'
)
WHERE alias IN ('mokhtasar', 'muntakhab')
  AND type='tafsir';

UPDATE books
SET properties=JSON_REMOVE(properties, '$.quran')
WHERE alias IN ('mokhtasar', 'muntakhab')
  AND type='tafsir'
  AND JSON_LENGTH(JSON_EXTRACT(properties, '$.quran'))=0;
