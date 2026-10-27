'use strict';

const axios = require('axios');
const SearchHttp = require('./SearchHttp');
const SharhBooks = require('./SharhBooks');
const debug = require('./Debug')('hadithdb:SharhNavigation');
const INDEX = 'sharh_navigation';
const VERSION = 1;
const ids = values => [...new Set(values.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
const url = path => `${global.settings.search.domain}/${INDEX}${path}`;
const config = () => SearchHttp.axiosConfig({ timeout: 10000 });

// One atomic document per book preserves the complete order, including headings,
// duplicate passages and virtual source ownership. Rows need storage, not search.
async function ensureIndex() {
	try {
		await axios.put(url(''), { mappings: { dynamic: 'strict', properties: {
			version: { type: 'integer' }, bookId: { type: 'long' }, alias: { type: 'keyword' },
			source_book_ids: { type: 'long' }, hadith_ids: { type: 'long' }, heading_ids: { type: 'long' },
			rows: { type: 'object', enabled: false }
		} } }, config());
	} catch (error) {
		if (error.response?.data?.error?.type !== 'resource_already_exists_exception') throw error;
	}
}

function valid(doc, book) {
	if (!doc || doc.version !== VERSION || doc.bookId !== Number(book.id) || doc.alias !== book.alias || !Array.isArray(doc.rows)) return false;
	const seen = new Set();
	return doc.rows.every(row => {
		if (!Number.isSafeInteger(row.id) || row.id <= 0 || !['hadith', 'heading'].includes(row.kind)) return false;
		if (row.kind === 'heading' ? row.reference !== String(row.id)
			: !/^[a-z0-9][a-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(row.reference || '')) return false;
		const key = `${row.kind}:${row.id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

async function get(id) {
	try { return (await axios.get(url(`/_doc/${id}`), config())).data; }
	catch (error) { if (error.response?.status === 404) return null; throw error; }
}

async function read(book) {
	try {
		const result = await get(Number(book.id));
		return valid(result?._source, book) ? result._source.rows : null;
	} catch (error) {
		debug.error(`ES navigation unavailable for ${book.alias}: ${error.message}`);
		return null; // SQL/disk fallback keeps the reader working during an outage.
	}
}

function document(book, rows) {
	return {
		version: VERSION, bookId: Number(book.id), alias: book.alias,
		source_book_ids: ids(rows.flatMap(row => [row.physical_book_id, ...String(row.source_ids || row.source_id || '').split(',')])),
		hadith_ids: ids(rows.filter(row => row.kind === 'hadith').map(row => row.id)),
		heading_ids: ids(rows.filter(row => row.kind === 'heading').map(row => row.toc_id)),
		rows
	};
}

async function refreshBook(book) {
	const Sharh = require('./Sharh');
	for (let attempt = 0; attempt < 3; attempt++) {
		// Read the ES revision BEFORE SQL: an overlapping refresh cannot publish
		// an older SQL result over a more recent snapshot from another worker.
		const previous = await get(Number(book.id));
		const doc = document(book, await Sharh.buildReaderSequence(book));
		if (!valid(doc, book)) throw new Error(`Invalid navigation sequence for ${book.alias}`);
		if (JSON.stringify(previous?._source) === JSON.stringify(doc)) return doc.rows.length;
		const condition = previous ? `if_seq_no=${previous._seq_no}&if_primary_term=${previous._primary_term}` : 'op_type=create';
		try { await axios.put(url(`/_doc/${book.id}?refresh=true&${condition}`), doc, config()); }
		catch (error) { if (error.response?.status === 409) continue; throw error; }
		await Sharh.invalidateReaderSequence(book);
		// Existing page HTML embeds neighbors, so invalidate it along with the sequence.
		await require('./Utils').flushCacheContaining(book.alias);
		return doc.rows.length;
	}
	throw new Error(`Concurrent navigation changes for ${book.alias}; retry indexing`);
}

async function refreshBooks(bookIds) {
	const selected = ids(bookIds);
	if (!selected.length) return;
	const books = await global.query(`SELECT id, alias FROM books WHERE type='sharh' AND id IN (${selected.join(',')}) ORDER BY id`);
	if (!books.length) return;
	await ensureIndex();
	for (const book of books) await refreshBook(book);
}

// Search old dependencies as well as current SQL ownership. This includes the
// previous book after a move, and books whose last passage has just been deleted.
async function previousBooks(field, values) {
	const found = [];
	let after = 0;
	try {
		while (true) {
			const response = await axios.post(url('/_search'), {
				query: { bool: { filter: [{ terms: { [field]: values } }, { range: { bookId: { gt: after } } }] } },
				_source: ['bookId'], size: 500, sort: [{ bookId: 'asc' }]
			}, config());
			if (response.data.timed_out || response.data._shards?.failed) throw new Error('Incomplete navigation dependency search');
			const hits = response.data.hits.hits;
			for (const hit of hits) {
				const id = Number(hit._source.bookId);
				if (!Number.isSafeInteger(id) || id <= after) throw new Error('Invalid navigation dependency result');
				after = id;
				found.push(id);
			}
			if (hits.length < 500) return found;
		}
	} catch (error) { if (error.response?.status === 404) return []; throw error; }
}

async function syncHadiths(hadithIds, currentBookIds) {
	const selected = ids(hadithIds);
	if (!selected.length) return;
	const old = await previousBooks('hadith_ids', selected);
	await refreshBooks([...old, ...currentBookIds]);
}

async function syncHeadings(headingIds) {
	const selected = ids(headingIds);
	if (!selected.length) return;
	const old = await previousBooks('heading_ids', selected);
	const current = await global.query(`SELECT DISTINCT sb.id FROM hdith_toc_sharh hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id ${SharhBooks.join()}
		WHERE hs.toc_id IN (${selected.join(',')})`);
	await refreshBooks([...old, ...current.map(book => book.id)]);
}

async function syncSourceBooks(bookIds) {
	const selected = ids(bookIds);
	if (!selected.length) return;
	const old = await previousBooks('source_book_ids', selected);
	const current = await global.query(`SELECT DISTINCT sb.id FROM hdith_hadith_sharh hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id ${SharhBooks.join()}
		JOIN hadiths h ON h.id=hs.hadith_id
		LEFT JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id
		LEFT JOIN hadiths_virtual hv ON hv.id=vl.virtual_id AND hv.hadithId=h.id
		WHERE h.bookId IN (${selected.join(',')}) OR hv.bookId IN (${selected.join(',')})
		UNION SELECT DISTINCT sb.id FROM hdith_toc_sharh hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id ${SharhBooks.join()}
		JOIN toc t ON t.id=hs.toc_id WHERE t.bookId IN (${selected.join(',')})`);
	await refreshBooks([...selected, ...old, ...current.map(book => book.id)]);
}

module.exports = { INDEX, VERSION, ensureIndex, read, document, valid, refreshBook, refreshBooks, syncHadiths, syncHeadings, syncSourceBooks };
