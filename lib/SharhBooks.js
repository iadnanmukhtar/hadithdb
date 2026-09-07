'use strict';
const mysql = require('mysql');
const { promisify } = require('util');
const Books = require('./Books');
let ready;

async function ensureSchema() {
	if (!ready) ready = global.query(`CREATE TABLE IF NOT EXISTS sharh_book_mappings (
		source_id INT NOT NULL,
		source_title VARCHAR(255) NOT NULL DEFAULT '',
		book_id INT NOT NULL,
		PRIMARY KEY (source_id, source_title),
		UNIQUE KEY sharh_book_id (book_id)
	) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`).catch(error => { ready = null; throw error; });
	await ready;
}

function mappingTitle(sourceBookId, title) {
	return Number(sourceBookId) === -1 ? (title || '') : '';
}

// Resolve by the imported identity, independent of editable names and aliases.
function bookForEntry(entry, books = global.books || []) {
	const title = mappingTitle(entry.source_book_id, entry.source_title);
	return books.find(book => {
		if (book.type !== 'sharh') return false;
		const identity = Books.normalizeBookProperties(book.properties).sharh;
		return identity && Number(identity.source_id) === Number(entry.source_id)
			&& (identity.source_title || '') === title;
	}) || null;
}

// Insert missing identities only. User-edited metadata is never overwritten.
async function sync() {
	await ensureSchema();
	const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
	const query = promisify(connection.query).bind(connection);
	try {
		const lock = await query("SELECT GET_LOCK('hadithdb-sharh-books', 30) AS acquired");
		if (Number(lock[0].acquired) !== 1) throw new Error('Unable to lock Sharh book migration');
		await query('START TRANSACTION');
		const sources = await query('SELECT * FROM hdith_sharh_sources ORDER BY id');
		const identities = sources.map(source => ({ ...source, source_title: '' }));
		for (const table of ['hdith_hadith_sharh', 'hdith_toc_sharh']) {
			if (!(await query(`SHOW TABLES LIKE ${mysql.escape(table)}`)).length) continue;
			const custom = await query(`SELECT hs.source_id, hs.title, MAX(NULLIF(hs.title_en, '')) AS title_en
				FROM ${table} hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
				WHERE ss.source_book_id=-1 AND NULLIF(hs.title, '') IS NOT NULL
				GROUP BY hs.source_id, hs.title`);
			for (const row of custom) {
				const source = sources.find(source => Number(source.id) === Number(row.source_id));
				identities.push({ ...source, title: row.title, title_en: row.title_en, source_title: row.title });
			}
		}
		let nextId = Number((await query('SELECT MAX(id) AS id FROM books'))[0].id) + 1;
		let created = 0;
		for (const identity of identities) {
			const existing = await query('SELECT book_id FROM sharh_book_mappings WHERE source_id=? AND source_title=?', [identity.id, identity.source_title]);
			if (existing.length) continue;
			const id = nextId++;
			const alias = `sharh-${id}`;
			const en = identity.title_en || identity.title;
			await query(`INSERT INTO books (id, ordinal, alias, type, hidden, source, format, lang,
				shortName, shortName_en, name, name_en, title, title_en, author, properties)
				VALUES (?, ?, ?, 'sharh', 1, 'local', 'md', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, id, alias, identity.title_en ? 'ar-en' : 'ar', identity.title.slice(0,120), en.slice(0,120),
				identity.title, en, identity.title, identity.title_en, identity.author,
				JSON.stringify({ sharh: { source_id: identity.id, source_title: identity.source_title, source_url: identity.source_url } })]);
			await query('INSERT INTO sharh_book_mappings (source_id, source_title, book_id) VALUES (?, ?, ?)', [identity.id, identity.source_title, id]);
			created++;
		}
		await query('COMMIT');
		return { created, sources: sources.length };
	} catch (error) {
		await query('ROLLBACK');
		throw error;
	} finally {
		await query("SELECT RELEASE_LOCK('hadithdb-sharh-books')");
		connection.release();
	}
}

function join(entry = 'hs', source = 'ss', mapping = 'sbm', book = 'sb') {
	return `JOIN sharh_book_mappings ${mapping} ON ${mapping}.source_id=${source}.id
		AND ${mapping}.source_title=CASE WHEN ${source}.source_book_id=-1 THEN COALESCE(${entry}.title, '') ELSE '' END
		JOIN books ${book} ON ${book}.id=${mapping}.book_id AND ${book}.type='sharh'`;
}

module.exports = { sync, ensureSchema, join, mappingTitle, bookForEntry };
