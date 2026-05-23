-- Replace Arabic written-out PBUH formula variants in hadith bodies with ﷺ.
--
-- Change management uses the existing hadiths_change_log table and
-- undo_hadith_change(change_id) procedure.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Set the target book before running the script.
SET @book_id := 16;
SET @change_id := UUID();
SET @change_name := CONCAT('replace_pbuh_tashkil_in_body_book_', @book_id);
SET @applied_by := CURRENT_USER();
SET @marks := _utf8mb4'[ًٌٍَُِّْٰٓ]*' COLLATE utf8mb4_unicode_ci;
SET @pbuh_replacement := _utf8mb4'ﷺ' COLLATE utf8mb4_unicode_ci;
SET @pbuh_pattern := CONCAT(
	'ص', @marks, 'ل', @marks, 'ى', @marks,
	'[[:space:]]+',
	'ا', @marks, 'ل', @marks, 'ل', @marks, 'ه', @marks,
	'[[:space:]]+',
	'ع', @marks, 'ل', @marks, 'ي', @marks, 'ه', @marks,
	'[[:space:]]+',
	'و', @marks, 'س', @marks, 'ل', @marks, 'م', @marks
) COLLATE utf8mb4_unicode_ci;

SELECT @change_id AS change_id;

SELECT
	@book_id AS book_id,
	alias,
	shortName_en,
	shortName
FROM
	books
WHERE
	id = @book_id;

SELECT
	COUNT(*) AS matching_hadiths
FROM
	hadiths
WHERE
	bookId = @book_id
AND body COLLATE utf8mb4_unicode_ci REGEXP @pbuh_pattern;

SELECT
	h.id,
	h.bookId,
	h.num,
	CONCAT(b.alias, ':', h.num) AS ref,
	REGEXP_SUBSTR(h.body COLLATE utf8mb4_unicode_ci, @pbuh_pattern) AS matched_text
FROM
	hadiths h
	LEFT JOIN books b ON b.id = h.bookId
WHERE
	h.bookId = @book_id
AND h.body COLLATE utf8mb4_unicode_ci REGEXP @pbuh_pattern
ORDER BY
	h.bookId,
	h.ordinal,
	h.id
LIMIT 100;

START TRANSACTION;

INSERT INTO hadiths_change_log (
	change_id,
	change_name,
	table_name,
	row_id,
	ref,
	old_chain,
	old_body,
	new_chain,
	new_body,
	applied_by
)
SELECT
	@change_id,
	@change_name,
	'hadiths',
	h.id,
	CONCAT(b.alias, ':', h.num),
	h.chain,
	h.body,
	h.chain,
	REGEXP_REPLACE(h.body COLLATE utf8mb4_unicode_ci, @pbuh_pattern, @pbuh_replacement) AS new_body,
	@applied_by
FROM
	hadiths h
	LEFT JOIN books b ON b.id = h.bookId
WHERE
	h.bookId = @book_id
AND h.body COLLATE utf8mb4_unicode_ci REGEXP @pbuh_pattern
AND NOT (h.body <=> REGEXP_REPLACE(h.body COLLATE utf8mb4_unicode_ci, @pbuh_pattern, @pbuh_replacement));

UPDATE
	hadiths h
	JOIN hadiths_change_log l
		ON l.change_id = @change_id
		AND l.table_name = 'hadiths'
		AND l.row_id = h.id
SET
	h.body = l.new_body
WHERE
	h.chain <=> l.old_chain
AND h.body <=> l.old_body;

-- The current BEFORE UPDATE trigger derives search_body from OLD.body.
-- Touch the changed rows again so search_body/search_text are rebuilt from the new body.
UPDATE
	hadiths h
	JOIN hadiths_change_log l
		ON l.change_id = @change_id
		AND l.table_name = 'hadiths'
		AND l.row_id = h.id
SET
	h.body = h.body
WHERE
	h.chain <=> l.new_chain
AND h.body <=> l.new_body;

SELECT
	@change_id AS change_id,
	COUNT(*) AS logged_hadiths
FROM
	hadiths_change_log
WHERE
	change_id = @change_id
AND table_name = 'hadiths';

SELECT
	COUNT(*) AS unapplied_log_rows
FROM
	hadiths_change_log l
	LEFT JOIN hadiths h ON h.id = l.row_id
WHERE
	l.change_id = @change_id
AND l.table_name = 'hadiths'
AND (
	h.id IS NULL
	OR NOT (h.chain <=> l.new_chain)
	OR NOT (h.body <=> l.new_body)
);

SELECT
	COUNT(*) AS remaining_matches
FROM
	hadiths
WHERE
	bookId = @book_id
AND body COLLATE utf8mb4_unicode_ci REGEXP @pbuh_pattern;

COMMIT;

-- Rollback this change if needed:
--
-- CALL undo_hadith_change('paste-change-id-here');
