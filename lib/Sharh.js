'use strict';

const mysql = require('mysql');
const SharhBooks = require('./SharhBooks');
const { Item } = require('./Model');
const Index = require('./Index');

function passageUrl(book, reference, kind = 'hadith') {
	return `/sharh/${encodeURIComponent(book.alias)}/${kind === 'heading' ? 'heading/' : ''}${kind === 'heading' ? reference : String(reference).split(':').map(encodeURIComponent).join(':')}`;
}

function decorate(entry, kind = 'hadith') {
	const book = SharhBooks.bookForEntry(entry);
	return { ...entry, ...(book ? { title: book.shortName || book.title, title_en: book.shortName_en || book.name_en || book.title_en } : {}), sharh_book: book, full_page_url: book && (kind === 'heading' || entry.hadith_ref) ? passageUrl(book, kind === 'heading' ? entry.id : entry.hadith_ref, kind) : null };
}

async function indexedRecord(index, id) {
	try { return await Index.docFromId(index, Number(id)); }
	catch (_) { return null; } // Keep the reader available when ES is unavailable.
}

async function hadithOwner(id) {
	const indexed = await indexedRecord(Item.INDEX, id);
	if (indexed && Number(indexed.hId || indexed.id) === Number(id)) {
		const current = (await global.query(`SELECT h.*, b.alias AS book_alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id=${Number(id)} LIMIT 1`))[0];
		if (!current) return null;
		// Use indexed reader metadata only while its structural identity is current.
		if (Number(indexed.book_id || indexed.bookId) === Number(current.bookId)
			&& Number(indexed.tId || indexed[`h${indexed.level}_id`]) === Number(current.tocId)
			&& Number(indexed.grade_id) === Number(current.gradeId)
			&& Number(indexed.grader_id) === Number(current.graderId)) {
			return { ...indexed, ...current, hId: current.id, ref: `${current.book_alias}:${current.num}` };
		}
	}
	return (await global.query(`SELECT * FROM v_hadiths WHERE hId=${Number(id)} LIMIT 1`))[0];
}

async function headingContext(current) {
	const indexed = await indexedRecord('toc', current.id);
	if (indexed && Number(indexed.tId || indexed.id) === Number(current.id)
		&& Number(indexed.book_id) === Number(current.bookId)
		&& ['level', 'h1', 'h2', 'h3'].every(field => Number(indexed[field] || 0) === Number(current[field] || 0))) {
		const row = { ...indexed, book_alias: current.book_alias };
		for (const field of ['id', 'title', 'title_en', 'intro', 'intro_en', 'start', 'count'])
			row[`h${current.level}_${field}`] = current[field];
		return row;
	}
	return (await global.query(`SELECT * FROM v_toc WHERE id=${Number(current.id)} LIMIT 1`))[0];
}

async function entryById(id, kind = 'hadith') {
	if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) return null;
	const table = kind === 'heading' ? 'hdith_toc_sharh' : 'hdith_hadith_sharh';
	const rows = await global.query(`SELECT hs.*, ss.source_book_id, hs.title AS source_title,
		sb.id AS book_id FROM ${table} hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${SharhBooks.join()} WHERE hs.id=${Number(id)} LIMIT 1`);
	if (!rows.length) return null;
	const entry = rows[0];
	const book = (await global.query(`SELECT * FROM books WHERE id=${Number(entry.book_id)} AND type='sharh'`))[0];
	if (!book) return null;
	const ownerRow = kind === 'heading'
		? (await global.query(`SELECT t.*, b.alias AS book_alias FROM toc t JOIN books b ON b.id=t.bookId WHERE t.id=${Number(entry.toc_id)} LIMIT 1`))[0]
		: await hadithOwner(entry.hadith_id);
	const owner = ownerRow && kind === 'hadith' ? new Item(ownerRow) : ownerRow;
	if (!owner) return null;
	if (kind === 'hadith') owner.single = true;

	return { entry, book, owner, kind, canonical: passageUrl(book, kind === 'heading' ? entry.id : `${owner.book_alias}:${owner.num}`, kind) };
}

async function entryByReference(alias, reference) {
	if (!/^[a-z0-9][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(reference || '')) return null;
	const colon = reference.indexOf(':');
	const rows = await global.query(`SELECT hs.id FROM hdith_hadith_sharh hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id ${SharhBooks.join()}
		JOIN hadiths h ON h.id=hs.hadith_id JOIN books hb ON hb.id=h.bookId
		WHERE sb.alias=${mysql.escape(alias)} AND hb.alias=${mysql.escape(reference.slice(0, colon))}
		AND h.num=${mysql.escape(reference.slice(colon + 1))} ORDER BY COALESCE(hs.ordinal, 65535), hs.id`);
	if (!rows.length) return null;
	const data = await entryById(rows[0].id);
	if (!data) return null;
	// A book can have more than one passage on a hadith; retain every passage.
	data.entries = [data.entry];
	if (rows.length > 1) {
		const remaining = await global.query(`SELECT * FROM hdith_hadith_sharh WHERE id IN (${rows.slice(1).map(row => Number(row.id)).join(',')}) ORDER BY COALESCE(ordinal, 65535), id`);
		data.entries.push(...remaining);
	}
	return data;
}

async function availableBooks({ owner, kind }) {
	if (!owner) return [];
	const table = kind === 'heading' ? 'hdith_toc_sharh' : 'hdith_hadith_sharh';
	const ownerKey = kind === 'heading' ? 'toc_id' : 'hadith_id';
	const rows = await global.query(`SELECT sb.*, MIN(hs.id) AS entry_id FROM ${table} hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id ${SharhBooks.join()}
		WHERE hs.${ownerKey}=${Number(owner.id)} AND (NULLIF(TRIM(hs.text), '') IS NOT NULL OR NULLIF(TRIM(hs.text_en), '') IS NOT NULL)
		GROUP BY sb.id ORDER BY sb.ordinal, sb.id`);
	return rows.map(book => ({ ...book, url: passageUrl(book, kind === 'heading' ? book.entry_id : `${owner.book_alias}:${owner.num}`, kind) }));
}

async function readerContext({ owner, entry, kind }) {
	if (!owner) return null;
	const current = kind === 'heading' ? owner : (await global.query(`SELECT t.*, b.alias AS book_alias FROM hdith_virtual_sharh_links l
		JOIN hadiths_virtual hv ON hv.id=l.virtual_id AND hv.hadithId=${Number(owner.id)}
		JOIN toc t ON t.id=hv.tocId JOIN books b ON b.id=t.bookId
		WHERE l.sharh_id=${Number(entry.id)} LIMIT 1`))[0];
	// Resolve the explicit source heading, not a guessed match against its title.
	const row = current ? await headingContext(current) : null;
	const contextItem = row ? new Item({ ...row, hId: owner.id }) : (kind === 'hadith' ? owner : null);
	if (!contextItem) return null;
	return { book: contextItem.book, chapter: contextItem.chapter, section: contextItem.section, subsection: contextItem.subsection };
}

async function catalog() {
	return global.query("SELECT * FROM books WHERE type='sharh' ORDER BY ordinal, id");
}

async function bookEntries(book, offset = 0) {
	// Stable entry IDs keep URLs valid when virtual hadith replacements move ownership.
	return global.query(`SELECT * FROM (
		SELECT hs.id, 'hadith' AS kind, CONCAT(hb.alias, ':', h.num) AS reference
		FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${SharhBooks.join()} JOIN hadiths h ON h.id=hs.hadith_id JOIN books hb ON hb.id=h.bookId
		WHERE sb.id=${mysql.escape(book.id)}
		UNION ALL
		SELECT hs.id, 'heading' AS kind, COALESCE(NULLIF(t.title_en, ''), t.title) AS reference
		FROM hdith_toc_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${SharhBooks.join()} JOIN toc t ON t.id=hs.toc_id WHERE sb.id=${mysql.escape(book.id)}
	) entries ORDER BY kind, id LIMIT 51 OFFSET ${offset}`);
}

// Count source entries once, even when several commentary passages cover them.
// Explicit virtual ownership takes precedence over the replacement's physical book.
async function coveredBooks(book) {
	return global.query(`SELECT b.id, b.alias, b.shortName, b.shortName_en, b.name, b.name_en, b.title,
		COUNT(DISTINCT coverage.hadith_key) AS hadith_count
		FROM (
			SELECT COALESCE(hv.bookId, h.bookId) AS book_id,
				CONCAT(IF(hv.id IS NULL, 'h:', 'v:'), COALESCE(hv.id, h.id)) AS hadith_key
			FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
			${SharhBooks.join()}
			JOIN hadiths h ON h.id=hs.hadith_id
			LEFT JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id
			LEFT JOIN hadiths_virtual hv ON hv.id=vl.virtual_id
			WHERE sb.id=${mysql.escape(book.id)}
			UNION ALL
			SELECT t.bookId AS book_id, NULL AS hadith_key
			FROM hdith_toc_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
			${SharhBooks.join()} JOIN toc t ON t.id=hs.toc_id
			WHERE sb.id=${mysql.escape(book.id)}
		) coverage JOIN books b ON b.id=coverage.book_id
		GROUP BY b.id, b.alias, b.shortName, b.shortName_en, b.name, b.name_en, b.title, b.ordinal
		ORDER BY b.ordinal, b.id`);
}

module.exports = { passageUrl, decorate, entryById, entryByReference, availableBooks, readerContext, catalog, bookEntries, coveredBooks };
