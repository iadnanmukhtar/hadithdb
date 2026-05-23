-- Replace Arabic written-out RA formula variants in hadith chains and bodies with ؓ.
--
-- Change management uses the existing hadiths_change_log table and
-- undo_hadith_change(change_id) procedure.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Set the target book before running the script.
SET @book_id := 16;
SET @change_id := UUID();
SET @change_name := CONCAT('replace_ra_tashkil_in_chain_body_book_', @book_id);
SET @applied_by := CURRENT_USER();
SET @marks := _utf8mb4'[ًٌٍَُِّْٰٓ]*' COLLATE utf8mb4_unicode_ci;
SET @ra_replacement := _utf8mb4'ؓ' COLLATE utf8mb4_unicode_ci;
SET @ra_pronoun_pattern := CONCAT(
	'ه', @marks, 'م', @marks, 'ا', @marks, '|',
	'ه', @marks, 'ا', @marks, '|',
	'ه', @marks, 'م', @marks, '|',
	'ه', @marks, 'ن', @marks, '|',
	'ه', @marks
) COLLATE utf8mb4_unicode_ci;
SET @ra_pattern := CONCAT(
	'ر', @marks, 'ض', @marks, 'ي', @marks,
	'[[:space:]]+',
	'ا', @marks, 'ل', @marks, 'ل', @marks, 'ه', @marks,
	'[[:space:]]+',
	'ع', @marks, 'ن', @marks,
	'(', @ra_pronoun_pattern, ')'
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
	COUNT(*) AS matching_hadiths,
	SUM(chain COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern) AS matching_chains,
	SUM(body COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern) AS matching_bodies
FROM
	hadiths
WHERE
	bookId = @book_id
AND (
	chain COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
	OR body COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
);

SELECT
	h.id,
	h.bookId,
	h.num,
	CONCAT(b.alias, ':', h.num) AS ref,
	REGEXP_SUBSTR(h.chain COLLATE utf8mb4_unicode_ci, @ra_pattern) AS matched_chain_text,
	REGEXP_SUBSTR(h.body COLLATE utf8mb4_unicode_ci, @ra_pattern) AS matched_body_text
FROM
	hadiths h
	LEFT JOIN books b ON b.id = h.bookId
WHERE
	h.bookId = @book_id
AND (
	h.chain COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
	OR h.body COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
)
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
	REGEXP_REPLACE(h.chain COLLATE utf8mb4_unicode_ci, @ra_pattern, @ra_replacement) AS new_chain,
	REGEXP_REPLACE(h.body COLLATE utf8mb4_unicode_ci, @ra_pattern, @ra_replacement) AS new_body,
	@applied_by
FROM
	hadiths h
	LEFT JOIN books b ON b.id = h.bookId
WHERE
	h.bookId = @book_id
AND (
	h.chain COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
	OR h.body COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
)
AND NOT (
	h.chain <=> REGEXP_REPLACE(h.chain COLLATE utf8mb4_unicode_ci, @ra_pattern, @ra_replacement)
	AND h.body <=> REGEXP_REPLACE(h.body COLLATE utf8mb4_unicode_ci, @ra_pattern, @ra_replacement)
);

UPDATE
	hadiths h
	JOIN hadiths_change_log l
		ON l.change_id = @change_id
		AND l.table_name = 'hadiths'
		AND l.row_id = h.id
SET
	h.chain = l.new_chain,
	h.body = l.new_body
WHERE
	h.chain <=> l.old_chain
AND h.body <=> l.old_body;

-- The current BEFORE UPDATE trigger derives search_chain/search_body from OLD values.
-- Touch the changed rows again so search_chain/search_body/search_text are rebuilt from the new values.
UPDATE
	hadiths h
	JOIN hadiths_change_log l
		ON l.change_id = @change_id
		AND l.table_name = 'hadiths'
		AND l.row_id = h.id
SET
	h.chain = h.chain,
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
	COUNT(*) AS remaining_hadiths,
	SUM(chain COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern) AS remaining_chains,
	SUM(body COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern) AS remaining_bodies
FROM
	hadiths
WHERE
	bookId = @book_id
AND (
	chain COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
	OR body COLLATE utf8mb4_unicode_ci REGEXP @ra_pattern
);

COMMIT;

-- Rollback this change if needed:
--
-- CALL undo_hadith_change('paste-change-id-here');
