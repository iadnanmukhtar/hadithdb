'use strict';
const mysql = require('mysql');
const { promisify } = require('util');
const Books = require('./Books');
let ready;
let linksReady;
async function ensureEntryBooks() {
 if (!linksReady) linksReady = (async () => {
  for (const table of ['hdith_hadith_sharh', 'hdith_toc_sharh']) {
   if (!(await global.query(`SHOW TABLES LIKE ${mysql.escape(table)}`)).length) continue;
   if (!(await global.query(`SHOW COLUMNS FROM ${table} LIKE 'book_id'`)).length)
    await global.query(`ALTER TABLE ${table} ADD COLUMN book_id INT NULL, ADD INDEX sharh_managed_book (book_id)`).catch(error => {
     // Another worker may have completed the same startup migration.
     if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    });
  }
 })().catch(error => { linksReady = null; throw error; });
 await linksReady;
}


async function ensureSchema() {
	if (!ready) ready = global.query(`CREATE TABLE IF NOT EXISTS sharh_book_mappings (
		source_id INT NOT NULL,
		source_title VARCHAR(255) NOT NULL DEFAULT '',
		book_id INT NOT NULL,
		PRIMARY KEY (source_id, source_title),
		KEY sharh_book_id (book_id)
	) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`).then(async () => {
		const indexes = await global.query("SHOW INDEX FROM sharh_book_mappings WHERE Key_name='sharh_book_id'");
		if (indexes.some(index => Number(index.Non_unique) === 0))
			await global.query('ALTER TABLE sharh_book_mappings DROP INDEX sharh_book_id, ADD INDEX sharh_book_id (book_id)');
	}).catch(error => { ready = null; throw error; });
	await ready;
}

function mappingTitle(sourceBookId, title) {
	return Number(sourceBookId) === -1 ? (title || '') : '';
}

// Resolve by the imported identity, independent of editable names and aliases.
function bookForEntry(entry, books = global.books || []) {
	if (entry.sharh_book_id) return books.find(book => book.type === 'sharh' && Number(book.id) === Number(entry.sharh_book_id)) || null;
	const title = mappingTitle(entry.source_book_id, entry.source_title);
	return books.find(book => {
		if (book.type !== 'sharh') return false;
		const properties = Books.normalizeBookProperties(book.properties);
		const identities = [properties.sharh, ...(properties.sharh_sources || [])].filter(Boolean);
		return identities.some(identity => Number(identity.source_id) === Number(entry.source_id)
			&& (identity.source_title || '') === title);
	}) || null;
}

// Insert missing identities only. User-edited metadata is never overwritten.
async function sync() {
	await ensureSchema();
	await ensureEntryBooks();
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
				WHERE ss.source_book_id=-1 AND hs.book_id IS NULL AND NULLIF(hs.title, '') IS NOT NULL
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
	return `LEFT JOIN sharh_book_mappings ${mapping} ON ${mapping}.source_id=${source}.id
		AND ${mapping}.source_title=CASE WHEN ${source}.source_book_id=-1 THEN COALESCE(${entry}.title, '') ELSE '' END
		JOIN books ${book} ON ${book}.id=COALESCE(${entry}.book_id, ${mapping}.book_id) AND ${book}.type='sharh'`;
}

// Inline pages are cached under the Hadith/heading owner, not the Sharh book.
async function affectedBookAliases(bookId) {
	const id = Number(bookId);
	if (!Number.isSafeInteger(id) || id <= 0) return [];
	const rows = await global.query(`SELECT DISTINCT b.alias
		FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${join()} JOIN hadiths h ON h.id=hs.hadith_id JOIN books b ON b.id=h.bookId
		WHERE sb.id=${id}
		UNION
		SELECT DISTINCT b.alias FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${join()} JOIN hadiths_virtual hv ON hv.hadithId=hs.hadith_id JOIN books b ON b.id=hv.bookId
		WHERE sb.id=${id}
		UNION
		SELECT DISTINCT b.alias FROM hdith_toc_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${join()} JOIN toc t ON t.id=hs.toc_id JOIN books b ON b.id=t.bookId
		WHERE sb.id=${id}`);
	return rows.map(row => row.alias);
}

// Selecting a book links this entry only; editing book metadata renames it everywhere.
async function assignEntryBook(kind, entryId, values) {
 await ensureEntryBooks();
 const table = kind === 'heading' ? 'hdith_toc_sharh' : 'hdith_hadith_sharh';
 const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
 const query = promisify(connection.query).bind(connection);
 try {
  const lock = await query("SELECT GET_LOCK('hadithdb-sharh-books', 30) AS acquired");
  if (Number(lock[0].acquired) !== 1) throw new Error('Unable to lock Sharh books');
  await query('START TRANSACTION');
  let book;
  if (values.bookId) {
   book = (await query("SELECT * FROM books WHERE id=? AND type='sharh'", [values.bookId]))[0];
   if (!book) throw new Error('Sharh book not found');
  } else {
   const ar = String(values.title || '').trim(), en = String(values.title_en || '').trim();
   if (!ar) throw new Error('An Arabic book name is required');
   const matches = await query("SELECT * FROM books WHERE type='sharh' AND BINARY shortName=BINARY ? AND BINARY COALESCE(shortName_en,'')=BINARY ?", [ar, en]);
   if (matches.length > 1) throw new Error('Choose the existing book from suggestions');
   book = matches[0];
   if (!book) {
    const id = Number((await query('SELECT MAX(id) AS id FROM books'))[0].id) + 1;
    await query(`INSERT INTO books (id,ordinal,alias,type,hidden,source,format,lang,shortName,shortName_en,name,name_en,title,title_en)
     VALUES (?,?,?,'sharh',1,'local','md',?,?,?,?,?,?,?)`, [id,id,`sharh-${id}`,en ? 'ar-en' : 'ar',ar,en,ar,en,ar,en]);
    book = (await query('SELECT * FROM books WHERE id=?',[id]))[0];
   }
  }
  const result = await query(`UPDATE ${table} SET book_id=? WHERE id=?`, [book.id, entryId]);
  if (!result.affectedRows) throw new Error('Explanation not found');
  await query('COMMIT');
  return book;
 } catch (error) { await query('ROLLBACK'); throw error; }
 finally { await query("SELECT RELEASE_LOCK('hadithdb-sharh-books')"); connection.release(); }
}

module.exports = { ensureEntryBooks, assignEntryBook, sync, ensureSchema, join, mappingTitle, bookForEntry, affectedBookAliases };
