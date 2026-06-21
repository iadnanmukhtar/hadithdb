/* jslint node:true, esversion:9 */
'use strict';

const Arabic = require('./Arabic');

const HADITH_BOOK_SOURCE = 'books';
const COMMENTARY_BOOK_SOURCE = 'books_commentaries';
const UNIFIED_COMMENTARY_SOURCE = 'books';

const COMMENTARY_BOOK_COLUMNS = [
	'id',
	'alias',
	'type',
	'shortName_en',
	'shortName',
	'name_en',
	'name',
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
	'ordinal',
	'surah_dir',
	'hidden'
];

const UNIFIED_COMMENTARY_BOOK_COLUMNS = [
	'id',
	'legacyCommentaryBookId',
	'ordinal',
	'alias',
	'type',
	'shortName_en',
	'shortName',
	'name_en',
	'name',
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
	'hidden'
];

const columnCache = new Map();

function searchAliases(data, lang) {
	var values;
	if (lang === 'ar') {
		values = [data.book_name || data.name, data.book_shortName || data.shortName];
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
	book.source_table = sourceTable;
	book.source_id = row.id;
	if (sourceTable === COMMENTARY_BOOK_SOURCE || isCommentaryBook(book)) {
		book.book_model = commentaryType(row);
		book.book_type = book.book_model;
		book.bookCommentaryId = row.legacyCommentaryBookId || row.bookCommentaryId || row.id;
		book.legacyCommentaryBookId = row.legacyCommentaryBookId || row.bookCommentaryId || row.id;
		book.yearOfDeath = row.death;
		return book;
	}
	book.book_model = book.alias === 'quran' ? 'quran' : 'hadith';
	book.book_type = book.book_model;
	book.legacyBookId = row.id;
	return book;
}

function commentaryType(row) {
	return (row && row.type ? row.type : 'tafsir').toString();
}

function isCommentaryBook(row) {
	var type = row && row.type ? row.type.toString() : '';
	return type === 'tafsir' || type === 'trans' || row.legacyCommentaryBookId !== undefined || row.bookCommentaryId !== undefined;
}

async function allCommentaryBooks() {
	if (await unifiedCommentaryBooksAvailable()) {
		var unifiedRows = await global.query(`
			SELECT ${UNIFIED_COMMENTARY_BOOK_COLUMNS.join(', ')}
			FROM books
			WHERE legacyCommentaryBookId IS NOT NULL
				OR type IN ('tafsir', 'trans')
			ORDER BY type, lang, ordinal, id`);
		return unifiedRows.map(row => normalizeBook(row, UNIFIED_COMMENTARY_SOURCE));
	}
	var rows = await global.query(`
		SELECT ${COMMENTARY_BOOK_COLUMNS.join(', ')}
		FROM ${COMMENTARY_BOOK_SOURCE}
		ORDER BY type, lang, ordinal, id`);
	return rows.map(row => normalizeBook(row, COMMENTARY_BOOK_SOURCE));
}

async function refreshUnifiedCatalog() {
	global.bookCatalog = [
		...(global.books || []).map(row => normalizeBook(row, HADITH_BOOK_SOURCE)),
		...(global.commentaries || []).map(row => normalizeBook(row, COMMENTARY_BOOK_SOURCE))
	];
	global.booksByModel = new Map();
	global.bookCatalog.forEach(book => {
		var type = book.book_model || book.book_type || 'unknown';
		if (!global.booksByModel.has(type))
			global.booksByModel.set(type, []);
		global.booksByModel.get(type).push(book);
	});
	return global.bookCatalog;
}

async function commentaryBookStorage() {
	if (await unifiedCommentaryBooksAvailable()) {
		return {
			table: 'books',
			sourceTable: UNIFIED_COMMENTARY_SOURCE,
			idColumn: 'id',
			legacyIdExpression: 'legacyCommentaryBookId',
			unified: true
		};
	}
	return {
		table: COMMENTARY_BOOK_SOURCE,
		sourceTable: COMMENTARY_BOOK_SOURCE,
		idColumn: 'id',
		legacyIdExpression: 'id',
		unified: false
	};
}

async function commentaryJoin(alias = 'bc', passageAlias = 'hc') {
	var storage = await commentaryBookStorage();
	var passageBookColumn = await hasTableColumn('hadiths_commentary', 'bookId') && storage.unified ? 'bookId' : 'bookCommentaryId';
	return {
		storage,
		passageBookColumn,
		from: `${storage.table} ${alias}`,
		join: `JOIN hadiths_commentary ${passageAlias} ON ${passageAlias}.${passageBookColumn}=${alias}.${storage.idColumn}`,
		legacyIdSelect: `${alias}.${storage.legacyIdExpression} AS bookCommentaryId`,
		bookIdSelect: storage.unified ? `${alias}.id AS commentary_book_id` : `NULL AS commentary_book_id`,
		typePredicate: storage.unified ? `${alias}.type IN ('tafsir', 'trans')` : '1=1'
	};
}

async function commentaryBookByAlias(alias) {
	var storage = await commentaryBookStorage();
	var rows = await global.query(`
		SELECT id, alias, source, hidden, ${storage.legacyIdExpression} AS legacyCommentaryBookId
		FROM ${storage.table}
		WHERE alias=${global.dbPool.escape(alias)}
			AND source='local'
			AND hidden=0
			${storage.unified ? "AND type IN ('tafsir', 'trans')" : ''}
		LIMIT 1`);
	return rows[0] ? normalizeBook(rows[0], storage.sourceTable) : null;
}

async function commentaryPassageBookColumns(book) {
	var hasBookId = await hasTableColumn('hadiths_commentary', 'bookId');
	var hasLegacyBookCommentaryId = await hasTableColumn('hadiths_commentary', 'bookCommentaryId');
	var columns = [];
	var values = [];
	if (hasLegacyBookCommentaryId && book.legacyCommentaryBookId) {
		columns.push('bookCommentaryId');
		values.push(Number(book.legacyCommentaryBookId));
	}
	if (hasBookId) {
		columns.push('bookId');
		values.push(Number(book.id));
	}
	if (columns.length < 1)
		throw new Error('hadiths_commentary has no supported commentary book foreign key column.');
	return { columns, values };
}

async function commentaryPassageBookWhere(book, alias = 'hc') {
	if (await hasTableColumn('hadiths_commentary', 'bookId') && book.id)
		return `${alias}.bookId=${Number(book.id)}`;
	return `${alias}.bookCommentaryId=${Number(book.legacyCommentaryBookId || book.bookCommentaryId || book.id)}`;
}

async function unifiedCommentaryBooksAvailable() {
	if (!await hasTableColumn('books', 'legacyCommentaryBookId') || !await hasTableColumn('books', 'type'))
		return false;
	var rows = await global.query(`
		SELECT COUNT(*) AS total
		FROM books
		WHERE legacyCommentaryBookId IS NOT NULL
			OR type IN ('tafsir', 'trans')`);
	return Number(rows[0]?.total || 0) > 0;
}

async function hasTableColumn(table, column) {
	var columns = await tableColumns(table);
	return columns.has(column);
}

async function tableColumns(table) {
	if (!columnCache.has(table)) {
		var rows = await global.query(`SHOW COLUMNS FROM ${table}`);
		columnCache.set(table, new Set(rows.map(row => row.Field)));
	}
	return columnCache.get(table);
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
	commentaryBookStorage,
	commentaryJoin,
	commentaryPassageBookColumns,
	commentaryPassageBookWhere,
	findReference,
	hasTableColumn,
	matchesQuery,
	normalizeBook,
	refreshUnifiedCatalog,
	searchAliases
};
