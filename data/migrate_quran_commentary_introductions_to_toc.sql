-- Quran commentary authored introductions use the standard toc hierarchy:
-- h1=0 contains whole-work introduction articles as level-2 headings;
-- h1=1..114 contains each commentary's per-surah introduction.

INSERT INTO toc
  (ordinal, bookId, level, h1, h2, h3, title_en, title, lastfixed)
SELECT 0, legacy.bookId, 1, 0, NULL, NULL, 'Introduction', 'المقدمة', CURRENT_TIMESTAMP()
FROM quran_commentary_introductions legacy
WHERE legacy.surah=0
  AND (COALESCE(legacy.introduction_en, '') <> '' OR COALESCE(legacy.introduction, '') <> '')
  AND NOT EXISTS (
    SELECT 1 FROM toc WHERE toc.bookId=legacy.bookId AND toc.level=1 AND toc.h1=0
  );

INSERT INTO toc
  (ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, lastfixed)
SELECT 1, legacy.bookId, 2, 0, 1, NULL,
  CASE WHEN legacy.introduction_en REGEXP '^#[^#]'
    THEN TRIM(SUBSTRING_INDEX(SUBSTRING(legacy.introduction_en, 2), '\n', 1))
    ELSE 'Introduction' END,
  CASE WHEN legacy.introduction REGEXP '^#[^#]'
    THEN TRIM(SUBSTRING_INDEX(SUBSTRING(legacy.introduction, 2), '\n', 1))
    ELSE 'المقدمة' END,
  CASE WHEN legacy.introduction_en REGEXP '^#[^#]'
    THEN TRIM(SUBSTRING(legacy.introduction_en, LOCATE('\n', legacy.introduction_en) + 1))
    ELSE legacy.introduction_en END,
  CASE WHEN legacy.introduction REGEXP '^#[^#]'
    THEN TRIM(SUBSTRING(legacy.introduction, LOCATE('\n', legacy.introduction) + 1))
    ELSE legacy.introduction END,
  CURRENT_TIMESTAMP()
FROM quran_commentary_introductions legacy
WHERE legacy.surah=0
  AND (COALESCE(legacy.introduction_en, '') <> '' OR COALESCE(legacy.introduction, '') <> '')
  AND NOT EXISTS (
    SELECT 1 FROM toc WHERE toc.bookId=legacy.bookId AND toc.level=2 AND toc.h1=0
  );

INSERT INTO toc
  (ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, lastfixed)
SELECT legacy.surah * 1000, legacy.bookId, 1, legacy.surah, NULL, NULL,
  CONCAT('Surah ', legacy.surah), CONCAT('السورة ', legacy.surah),
  legacy.introduction_en, legacy.introduction, CURRENT_TIMESTAMP()
FROM quran_commentary_introductions legacy
WHERE legacy.surah BETWEEN 1 AND 114
  AND (COALESCE(legacy.introduction_en, '') <> '' OR COALESCE(legacy.introduction, '') <> '')
  AND NOT EXISTS (
    SELECT 1 FROM toc WHERE toc.bookId=legacy.bookId AND toc.level=1 AND toc.h1=legacy.surah
  );
