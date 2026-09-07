'use strict';
const axios = require('axios');
const { gzipSync } = require('zlib');
const SearchHttp = require('./SearchHttp');
const SharhBooks = require('./SharhBooks');

const properties = {
	id: { type: 'long' }, hId: { type: 'long' }, hadithId: { type: 'long' },
	book_id: { type: 'long' }, bookId: { type: 'long' }, book_ordinal: { type: 'long' }, ordinal: { type: 'long' },
	doctype: { type: 'keyword' }, ref: { type: 'keyword' }, book_alias: { type: 'keyword' },
	commentary_alias: { type: 'keyword' }, source: { type: 'keyword' }, format: { type: 'keyword' },
	books: { type: 'text' }, text: { type: 'text', analyzer: 'arabic' }, text_en: { type: 'text', analyzer: 'english' }
};

async function ensureIndex() {
	const url = `${global.settings.search.domain}/sharhs`;
	try { await axios.put(url, { mappings: { properties } }, SearchHttp.axiosConfig()); }
	catch (error) {
		if (error.response?.data?.error?.type !== 'resource_already_exists_exception') throw error;
		await axios.put(`${url}/_mapping`, { properties }, SearchHttp.axiosConfig());
	}
}

async function documents(where = '1=1', limit = 250) {
	return global.query(`SELECT STRAIGHT_JOIN hs.id, hs.id AS hId, hs.hadith_id AS hadithId,
		'sharh' AS doctype, h.bookId AS book_id, hb.ordinal AS book_ordinal,
		hs.id AS ordinal, hb.alias AS book_alias, sb.id AS bookId, sb.alias AS commentary_alias,
		sb.shortName AS commentary_shortName, sb.shortName_en AS commentary_shortName_en,
		sb.name_en AS commentary_name_en, sb.title AS commentary_name,
		sb.author AS commentary_author, sb.author_en AS commentary_author_en,
		'local' AS source, hs.format, CONCAT(hb.alias, ':', h.num) AS ref,
		hs.text, hs.text_en,
		(SELECT GROUP_CONCAT(CONCAT('{', vb.alias, '}') SEPARATOR ' ')
		 FROM hadiths_virtual hv JOIN books vb ON vb.id=hv.bookId WHERE hv.hadithId=h.id) AS books
		FROM hdith_hadith_sharh hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		${SharhBooks.join()}
		JOIN hadiths h ON h.id=hs.hadith_id JOIN books hb ON hb.id=h.bookId
		WHERE ${where} ORDER BY hs.id LIMIT ${Number(limit)}`);
}

async function writeBatch(batch) {
	if (!batch.length) return;
	const body = batch.flatMap(row => [JSON.stringify({ index: { _id: row.id } }), JSON.stringify(row)]).join('\n') + '\n';
	try {
		const response = await axios.post(`${global.settings.search.domain}/sharhs/_bulk`, gzipSync(Buffer.from(body)),
			SearchHttp.axiosConfig({ headers: { 'Content-Type': 'application/x-ndjson', 'Content-Encoding': 'gzip' }, timeout: 120000 }));
		const failures = response.data.items.filter(item => item.index.error);
		if (failures.length) throw new Error(JSON.stringify(failures.slice(0, 3)));
	} catch (error) {
		if (error.response?.status !== 413 || batch.length < 2) throw error;
		const middle = Math.ceil(batch.length / 2);
		await writeBatch(batch.slice(0, middle));
		await writeBatch(batch.slice(middle));
	}
}

async function syncHadiths(rows) {
	const ids = [...new Set(rows.filter(row => row.book_alias !== 'quran')
		.map(row => Number(row.hId || row.id)).filter(id => Number.isInteger(id) && id > 0))];
	if (!ids.length) return;
	if (!(await global.query("SHOW TABLES LIKE 'hdith_hadith_sharh'")).length) return;
	const catalog = await SharhBooks.sync();
	if (catalog.created) await require('./Model').Library.reloadBooks();
	await ensureIndex();
	for (let offset = 0; offset < ids.length; offset += 250) {
		const batchIds = ids.slice(offset, offset + 250);
		const docs = await documents(`hs.hadith_id IN (${batchIds.join(',')})`, 100000);
		// Remove deleted explanations without discarding unrelated Hadith documents.
		await axios.post(`${global.settings.search.domain}/sharhs/_delete_by_query?conflicts=proceed&refresh=true`,
			{ query: { bool: { filter: [{ terms: { hadithId: batchIds } }], must_not: [{ ids: { values: docs.map(doc => String(doc.id)) } }] } } }, SearchHttp.axiosConfig());
		await writeBatch(docs);
	}
	await axios.post(`${global.settings.search.domain}/sharhs/_refresh`, null, SearchHttp.axiosConfig());
}

module.exports = { documents, ensureIndex, writeBatch, syncHadiths };
