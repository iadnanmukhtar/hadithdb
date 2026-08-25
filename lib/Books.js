/* jslint node:true, esversion:9 */
'use strict';

const Arabic = require('./Arabic');

const HADITH_BOOK_SOURCE = 'books';
const UNIFIED_COMMENTARY_SOURCE = 'books';
let contentLastmodColumnEnsured = false;

const UNIFIED_COMMENTARY_BOOK_COLUMNS = [
	'id',
	'ordinal',
	'alias',
	'type',
	'shortName_en',
	'shortName',
	'name_en',
	'name',
	'title_en',
	'title',
	'author_en',
	'author',
	'death',
	'published_year',
	'publisher',
	'description',
	'aqidah',
	'size',
	'lang',
	'source',
	'format',
	'surah_dir',
	'hidden',
	'properties'
];

const COMMENTARY_FOOTNOTE_SIZES = new Set(['sm', 'md', 'lg']);

function searchAliases(data, lang) {
	var values;
	if (lang === 'ar') {
		values = [data.book_name || data.title, data.book_shortName || data.shortName];
		return unique(values.concat(values.map(removeArabicDiacritics)));
	}
	values = [data.book_alias || data.alias, data.book_name_en || data.name_en, data.book_shortName_en || data.shortName_en];
	var folded = values.map(removeLatinDiacritics);
	return unique(values.concat(
		folded,
		folded.map(removeLatinArticles),
		aliasSeparators(data.book_alias || data.alias)
	));
}

function normalizeBook(row, sourceTable) {
	row = row || {};
	var book = { ...row };
	book.properties = normalizeBookProperties(row.properties);
	book.source_table = sourceTable;
	book.source_id = row.id;
	if (isCommentaryBook(book)) {
		book.book_model = commentaryType(row);
		book.book_type = book.book_model;
		return book;
	}
	book.book_model = book.alias === 'quran' ? 'quran' : 'hadith';
	book.book_type = book.book_model;
	book.legacyBookId = row.id;
	return book;
}

function normalizeBookProperties(value) {
	if (Buffer.isBuffer(value))
		value = value.toString();
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch (_err) {
			return {};
		}
	}
	return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function commentaryFootnoteSize(book) {
	var properties = normalizeBookProperties(book && book.properties);
	var size = properties.rendering && properties.rendering.footnotes;
	return COMMENTARY_FOOTNOTE_SIZES.has(size) ? size : 'sm';
}

function commentaryType(row) {
	return (row && row.type ? row.type : 'tafsir').toString();
}

function isCommentaryBook(row) {
	var type = row && row.type ? row.type.toString() : '';
	return type === 'tafsir' || type === 'trans';
}

async function allCommentaryBooks() {
	var unifiedRows = await global.query(`
		SELECT ${UNIFIED_COMMENTARY_BOOK_COLUMNS.join(', ')}
		FROM books
		WHERE type IN ('tafsir', 'trans')
		ORDER BY type, lang, ordinal, id`);
	return unifiedRows.map(row => normalizeBook(row, UNIFIED_COMMENTARY_SOURCE));
}

async function refreshUnifiedCatalog() {
	var catalogByKey = new Map();
	(global.books || []).forEach(row => {
		var book = normalizeBook(row, HADITH_BOOK_SOURCE);
		catalogByKey.set(bookKey(book), book);
	});
	(global.commentaries || []).forEach(row => {
		var book = normalizeBook(row, UNIFIED_COMMENTARY_SOURCE);
		var key = bookKey(book);
		if (!catalogByKey.has(key))
			catalogByKey.set(key, book);
	});
	global.bookCatalog = Array.from(catalogByKey.values());
	global.booksByModel = new Map();
	global.bookCatalog.forEach(book => {
		var type = book.book_model || book.book_type || 'unknown';
		if (!global.booksByModel.has(type))
			global.booksByModel.set(type, []);
		global.booksByModel.get(type).push(book);
	});
	return global.bookCatalog;
}

async function ensureBookContentLastmodColumn() {
	if (contentLastmodColumnEnsured)
		return;
	var rows = await global.query(`SHOW COLUMNS FROM books LIKE 'content_lastmod'`);
	if (!rows.length) {
		var lastmodRows = await global.query(`SHOW COLUMNS FROM books LIKE 'lastmod'`);
		await global.query(`
			ALTER TABLE books
			ADD COLUMN content_lastmod datetime DEFAULT CURRENT_TIMESTAMP${lastmodRows.length ? ' AFTER lastmod' : ''}`);
	}
	contentLastmodColumnEnsured = true;
}

async function touchBookContentLastmodById(bookId) {
	await ensureBookContentLastmodColumn();
	if (!Number.isInteger(Number(bookId)))
		return;
	await global.query(`UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=${Number(bookId)}`);
}

async function touchBookContentLastmodByAlias(alias) {
	await ensureBookContentLastmodColumn();
	if (!alias)
		return;
	await global.query(`UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE alias=${global.dbPool.escape(alias)}`);
}

function bookKey(book) {
	return `${book.id}:${book.alias}:${book.type || book.book_type || book.book_model || ''}`;
}

async function commentaryJoin(alias = 'bc', passageAlias = 'hc') {
	return {
		passageBookColumn: 'bookId',
		from: `books ${alias}`,
		join: `JOIN hadiths_commentary ${passageAlias} ON ${passageAlias}.bookId=${alias}.id`,
		bookIdSelect: `${alias}.id AS bookId`,
		typePredicate: `${alias}.type IN ('tafsir', 'trans')`
	};
}

async function commentaryBookByAlias(alias) {
	var rows = await global.query(`
		SELECT id, alias, source, hidden
		FROM books
		WHERE alias=${global.dbPool.escape(alias)}
			AND source='local'
			AND hidden=0
			AND type IN ('tafsir', 'trans')
		LIMIT 1`);
	return rows[0] ? normalizeBook(rows[0], UNIFIED_COMMENTARY_SOURCE) : null;
}

async function commentaryPassageBookColumns(book) {
	return { columns: ['bookId'], values: [Number(book.id)] };
}

async function commentaryPassageBookWhere(book, alias = 'hc') {
	return `${alias}.bookId=${Number(book.id)}`;
}

function matchesQuery(data, query, lang) {
	var normalizedQuery = normalize(query, lang);
	if (normalizedQuery === '')
		return false;
	return searchAliases(data, lang).some(alias => normalize(alias, lang).startsWith(normalizedQuery));
}

function findReference(query, books) {
	var reference = Arabic.toLatinDigits(query || '').trim().match(/^(.+?)[\s:]+(\d+[a-z]*)$/iu);
	if (!reference || !Array.isArray(books))
		return null;
	var bookQuery = reference[1];
	var lang = Arabic.isArabic(bookQuery) ? 'ar' : 'en';
	var normalizedQuery = normalize(bookQuery, lang);
	var book = books.find(function (candidate) {
		return candidate?.alias !== 'quran' && searchAliases(candidate, lang).some(alias => normalize(alias, lang) === normalizedQuery);
	});
	if (!book)
		return null;
	var num = reference[2].toLowerCase();
	return {
		book: book,
		num: num,
		ref: `${book.alias}:${num}`
	};
}

function normalize(value, lang) {
	value = (value || '').toString();
	if (lang === 'ar')
		return Arabic.normalize(Arabic.removeArabicDiacritics(value)).replace(/[^\p{L}\d]+/gu, '');
	return removeLatinDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function removeLatinArticles(value) {
	return (value || '').replace(/\b(?:al|an|ar|as|ash|at|ad|adh|az)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function aliasSeparators(alias) {
	alias = (alias || '').toString().trim();
	if (alias === '')
		return [];
	return [
		alias.replace(/[-_]+/g, ' '),
		alias.replace(/[-_]+/g, ''),
		alias.replace(/[-_]+/g, '-')
	];
}

function removeArabicDiacritics(value) {
	return Arabic.removeArabicDiacritics(value || '');
}

function removeLatinDiacritics(value) {
	return Arabic.removeLatinDiacritics(value || '')
		.replace(/[ʿʾ'’`]/g, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function unique(values) {
	return Array.from(new Set(values.filter(value => typeof value === 'string' && value.trim() !== '')));
}

module.exports = {
	allCommentaryBooks,
	commentaryBookByAlias,
	commentaryJoin,
	commentaryPassageBookColumns,
	commentaryPassageBookWhere,
	commentaryFootnoteSize,
	ensureBookContentLastmodColumn,
	findReference,
	matchesQuery,
	normalizeBook,
	normalizeBookProperties,
	refreshUnifiedCatalog,
	searchAliases,
	touchBookContentLastmodByAlias,
	touchBookContentLastmodById
};
