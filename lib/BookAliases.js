'use strict';

const { promisify } = require('util');
const createError = require('http-errors');
const axios = require('axios');
const Books = require('./Books');
const SearchHttp = require('./SearchHttp');

// These names already own application routes or search scopes.
const RESERVED = new Set('quran hadith sharh entry heading toc tafsir tafsirs trans translations commentaries sirah books admin api static vendor blog about terms settings login logout search recent highlights commented titled requests tag liked bookmarks notebook mcp mcp-server sitemap robots autocomplete sahihayn kutubarbaah sixbooks ninebooks juz manzil page pages study review memorization'.split(' '));
const slug = alias => String(alias || '').replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
const key = alias => String(alias || '').toLowerCase().replace(/[-_]/g, '');
const properties = book => Books.normalizeBookProperties(book.properties);
const history = book => Array.isArray(properties(book).url_aliases) ? properties(book).url_aliases.filter(value => typeof value === 'string') : [];

function validate(book, alias, books) {
	if (!book) throw createError(404, 'Book not found');
	if (book.type === 'quran' || book.alias === 'quran') throw createError(400, 'The Quran alias is fixed because it owns the Quran application routes.');
	if (!/^[a-z][a-z0-9_-]{0,79}$/.test(alias)) throw createError(400, 'Use 1–80 lowercase letters, numbers, hyphens, or underscores, starting with a letter.');
	if (alias !== book.alias && RESERVED.has(alias)) throw createError(400, 'This alias is reserved for an application route.');
	const aliases = book.type === 'tafsir' ? [alias, slug(alias)] : [alias];
	if (aliases.some(value => !value)) throw createError(400, 'Use a nonempty book alias.');
	for (const other of books) {
		if (Number(other.id) === Number(book.id)) continue;
		const existing = [other.alias, ...history(other)];
		if (other.type === 'tafsir') existing.push(...existing.map(slug));
		if (aliases.some(value => existing.some(candidate => key(candidate) === key(value))))
			throw createError(409, 'This alias is already used by another book or one of its previous URLs.');
	}
}

async function save(id, alias) {
	id = Number(id);
	if (!Number.isSafeInteger(id) || id < 0) throw createError(400, 'Invalid book ID');
	alias = String(alias || '').trim();
	const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
	const query = promisify(connection.query).bind(connection);
	try {
		await query('START TRANSACTION');
		// Serialize alias allocation, including historical names kept for redirects.
		const books = await query('SELECT * FROM books ORDER BY id FOR UPDATE');
		const before = books.find(book => Number(book.id) === id);
		validate(before, alias, books);
		const props = { ...properties(before) };
		props.url_aliases = [...new Set([...history(before), before.alias])].filter(value => value !== alias);
		if (before.source === 'tafsir.app' && !props.source_alias) props.source_alias = before.alias;
		props.alias_refresh_pending = true;
		await query('UPDATE books SET alias=?, properties=?, content_lastmod=CURRENT_TIMESTAMP() WHERE id=?', [alias, JSON.stringify(props), id]);
		await query('COMMIT');
		return { before, book: { ...before, alias, properties: props } };
	} catch (error) {
		await query('ROLLBACK');
		throw error;
	} finally { connection.release(); }
}

function canonicalPath(requestPath, books = global.books || []) {
	for (const book of books) {
		if (book.type === 'sharh') continue;
		for (const old of history(book)) {
			let pairs;
			if (book.type === 'tafsir') pairs = [[`/quran/tafsir/${slug(old)}`, `/quran/tafsir/${slug(book.alias)}`], [`/quran/tafsir/${old}`, `/quran/tafsir/${slug(book.alias)}`], [`/tafsir/${old}`, `/quran/tafsir/${slug(book.alias)}`], [`/${old}`, `/quran/tafsir/${slug(book.alias)}`]];
			else if (book.type === 'trans') pairs = [[`/quran/${old}`, `/quran/${book.alias}`]];
			else pairs = [[`/${old}`, `/${book.alias}`]];
			for (const [from, to] of pairs) {
				if (requestPath === from || requestPath.startsWith(from) && /^[:/.]/.test(requestPath.slice(from.length))) return to + requestPath.slice(from.length);
			}
		}
	}
	return '';
}

function middleware(req, res, next) {
	if (!['GET', 'HEAD'].includes(req.method)) return next();
	const target = canonicalPath(req.path);
	if (!target || target === req.path) return next();
	const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
	return res.redirect(301, target + query);
}

function indexRequest(old, alias) {
	const exactFields = ['book_alias', 'book_alias_ref', 'commentary_alias'];
	const referenceFields = ['ref', 'ref_ref', 'path', 'path_ref', 'prev_ref', 'next_ref'];
	const searchFields = ['book_name_search_en', 'book_name_search_en_prefix', 'book_shortName_search_en', 'book_shortName_search_en_prefix'];
	return {
		query: { bool: { should: [...exactFields.map(field => ({ term: { [field]: old } })), { match_phrase: { books: old } }], minimum_should_match: 1 } },
		script: {
			lang: 'painless', params: { old, alias, exactFields, referenceFields, searchFields, separator: '\n' },
			source: `boolean ownBook = ctx._source.book_alias == params.old;
			for (def field : params.exactFields) { if (ctx._source[field] == params.old) ctx._source[field] = params.alias; }
			for (def field : params.referenceFields) { def value = ctx._source[field]; if (value instanceof String && (value.startsWith(params.old + ':') || value.startsWith(params.old + '/'))) ctx._source[field] = params.alias + value.substring(params.old.length()); }
			if (ownBook) { for (def field : params.searchFields) { if (ctx._source[field] instanceof String) ctx._source[field] += params.separator + params.alias + params.separator + params.alias.replace('-', ' ').replace('_', ' '); } }
			if (ctx._source.books instanceof String) ctx._source.books = ctx._source.books.replace('{' + params.old + '}', '{' + params.alias + '}');`
		}
	};
}

async function refresh(book) {
	const Utils = require('./Utils');
	const aliases = [...new Set([book.alias, ...history(book)])];
	const affected = await global.query(`SELECT DISTINCT hv.bookId FROM hadiths_virtual hv JOIN hadiths h ON h.id=hv.hadithId WHERE h.bookId=${Number(book.id)} OR hv.bookId=${Number(book.id)}`);
	for (const row of affected) await global.query(`CALL refresh_v_hadiths_virtual_snapshot(${Number(row.bookId)})`);
	for (const old of history(book)) {
		const result = await axios.post(`${global.settings.search.domain}/hadiths,toc,commentaries,sharhs/_update_by_query?refresh=true&conflicts=proceed&allow_no_indices=true&ignore_unavailable=true`, indexRequest(old, book.alias), SearchHttp.axiosConfig({ timeout: 120000 }));
		if (result.data.timed_out || result.data.failures?.length || result.data.version_conflicts) throw new Error('Search refresh is incomplete. Save this alias again to retry.');
	}
	const ownerAliases = (global.books || []).filter(row => affected.some(owner => Number(owner.bookId) === Number(row.id))).map(row => row.alias);
	if (book.type === 'sharh') ownerAliases.push(...await require('./SharhBooks').affectedBookAliases(book.id));
	for (const alias of new Set([...aliases, ...ownerAliases])) {
		await Utils.flushCacheContaining(alias);
		await Utils.flushBookDiskCache(alias, { strict: true });
	}
	for (const [name, type] of [['books', 'hadith'], ['tafsirs', 'tafsir'], ['translations', 'trans']]) {
		await Utils.flushCachedFile(Utils.cacheFileFromFilename(`_${name}`, 'html', name, type), { strict: true });
		await Utils.flushCacheContaining(name);
	}
	await require('./Hadith').a_reinit();
	await require('./RuntimeRefresh').publish();
	await global.query(`UPDATE books SET properties=JSON_REMOVE(properties, '$.alias_refresh_pending') WHERE id=${Number(book.id)}`);
}

async function list() {
	const rows = await global.query('SELECT id, type, alias, shortName, shortName_en, name_en, title, source, properties FROM books ORDER BY type, ordinal, id');
	return rows.map(({ properties: props, ...book }) => ({ ...book, refreshPending: !!Books.normalizeBookProperties(props).alias_refresh_pending }));
}

module.exports = { save, refresh, list, validate, canonicalPath, middleware, indexRequest, history };
