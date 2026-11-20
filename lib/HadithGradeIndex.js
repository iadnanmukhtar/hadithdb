'use strict';

const SearchHttp = require('./SearchHttp');
const MySQL = require('mysql');
const { gzipSync } = require('zlib');
const VERSION = 1;

function indexedRows(doc, id) {
	if (Number(doc?.hId) !== id || doc?.grader_opinions_version !== VERSION || !Array.isArray(doc.grader_opinions)) return null;
	if (doc.grader_opinions.some(row => !row?.id || !Object.hasOwn(row, 'grader_en'))) return null;
	return doc.grader_opinions.map(readerRow);
}

function readerRow({ source_slug, source, ...row }) {
	return row;
}

async function fallbackRows(ids) {
	return (await load(ids)).map(readerRow);
}

async function read(ids) {
	const result = new Map();
	if (!ids.length || !global.settings?.search?.domain) return result;
	try {
		const response = await SearchHttp.post(global.settings.search.domain + '/hadiths/_mget', {
			ids: ids.map(String)
		}, { params: { _source: 'hId,grader_opinions_version,grader_opinions' } });
		for (const doc of response.data.docs) {
			const id = Number(doc._id);
			const rows = indexedRows(doc._source, id);
			if (rows) result.set(id, rows);
		}
	} catch (error) {
		require('./Debug')('hadithdb:HadithGradeIndex').error('Grade index read failed: ' + error.message);
	}
	return result;
}

// Group translated rows using the column's MySQL collation. Each group yields
// its first translated id, so joining the earlier of the two candidates
// preserves the original ORDER BY id LIMIT 1 across both matching rules.
async function load(ids, query = global.query) {
	if (!ids.length) return [];
	const first = col => `(SELECT ${col}, MIN(id) AS first_id FROM hdith_hadith_grades
		WHERE NULLIF(grader_en,'') IS NOT NULL AND ${col} IS NOT NULL GROUP BY ${col})`;
	return query(`SELECT hg.hadith_id, hg.id, hg.grader, hg.grade, hg.grade_category_id,
		hg.grade_color, hg.source_slug, hg.source_name, hg.book_page, hg.source_url,
		COALESCE(hg.grade_en,(SELECT g.grade_en FROM grades g WHERE g.grade=hg.grade LIMIT 1)) AS grade_en,
		COALESCE(NULLIF(hg.grader_en,''), shared.grader_en,
			(SELECT gr.shortName_en FROM graders gr WHERE gr.shortName=hg.grader LIMIT 1)) AS grader_en,
		(SELECT gr.name_en FROM graders gr WHERE gr.shortName=hg.grader LIMIT 1) AS grader_name_en
		FROM hdith_hadith_grades hg
		LEFT JOIN ${first('grader_source_id')} s ON s.grader_source_id=hg.grader_source_id AND NULLIF(hg.grader_en,'') IS NULL
		LEFT JOIN ${first('grader')} n ON n.grader=hg.grader AND NULLIF(hg.grader_en,'') IS NULL
		LEFT JOIN hdith_hadith_grades shared ON shared.id=COALESCE(LEAST(s.first_id,n.first_id),s.first_id,n.first_id)
		WHERE hg.hadith_id IN (${ids.join(',')}) ORDER BY hg.hadith_id,hg.ordinal,hg.id`);
}

async function attach(rows, query = global.query) {
	const physical = rows.filter(row => Number(row.book_virtual) !== 1 && Number(row.book_id) !== 0);
	const ids = [...new Set(physical.map(row => Number(row.hId)).filter(id => Number.isSafeInteger(id) && id > 0))];
	if (!ids.length) return;
	const grouped = new Map();
	for (const { hadith_id, ...row } of await load(ids, query)) {
		const id = Number(hadith_id);
		if (!grouped.has(id)) grouped.set(id, []);
		grouped.get(id).push({ ...row, source: row.source_name });
	}
	for (const row of physical) {
		const id = Number(row.hId);
		if (!Number.isSafeInteger(id) || id <= 0) continue;
		row.grader_opinions = grouped.get(id) || [];
		row.grader_opinions_version = VERSION;
	}
}

// Include rows that inherit a translation from any donor being edited. The
// caller supplies a trusted SQL predicate with escaped values, before mutation.
async function affected(where, names = [], query = global.query) {
	const matches = ['(' + where + ')'];
	for (const key of ['grader_source_id', 'grader']) {
		matches.push(`(NULLIF(grader_en,'') IS NULL AND ${key} IN
			(SELECT ${key} FROM hdith_hadith_grades WHERE ${where}))`);
	}
	if (names.length) matches.push(`(NULLIF(grader_en,'') IS NULL AND grader IN (${names.map(name => MySQL.escape(name)).join(',')}))`);
	return query(`SELECT DISTINCT h.id AS hadith_id,b.alias FROM hadiths h
		JOIN books b ON b.id=h.bookId WHERE h.id IN (SELECT hadith_id FROM hdith_hadith_grades
		WHERE ${matches.join(' OR ')})`);
}

// Read ES revisions before reading SQL. If an intervening edit reindexes a
// document, retry from fresh SQL rather than overwriting its newer opinions.
async function refresh(ids, query = global.query, onlyMissing = false) {
	const domain = global.settings.search.domain;
	let updated = 0;
	for (let offset = 0; offset < ids.length; offset += 500) {
		let pending = ids.slice(offset, offset + 500);
		for (let attempt = 0; pending.length && attempt < 4; attempt++) {
			const { data } = await SearchHttp.post(domain + '/hadiths/_mget', { ids: pending.map(String) },
				{ params: { _source: 'hId,grader_opinions_version' } });
			const docs = data.docs.filter(doc => {
				if (doc.error) throw Error(JSON.stringify(doc.error));
				return doc.found && Number(doc._source.hId) === Number(doc._id)
					&& (!onlyMissing || doc._source.grader_opinions_version !== VERSION);
			});
			if (!docs.length) break;
			const rows = docs.map(doc => ({ hId: Number(doc._id) }));
			await attach(rows, query);
			const lines = [];
			for (const [i, doc] of docs.entries()) {
				const { hId, ...fields } = rows[i];
				lines.push(JSON.stringify({ update: { _id: doc._id, if_seq_no: doc._seq_no, if_primary_term: doc._primary_term } }),
					JSON.stringify({ doc: fields }));
			}
			const body = gzipSync(Buffer.from(lines.join('\n') + '\n'));
			const reply = await SearchHttp.post(domain + '/hadiths/_bulk', body,
				{ headers: { 'Content-Type': 'application/x-ndjson', 'Content-Encoding': 'gzip' }, timeout: 60000 });
			pending = [];
			for (const { update } of reply.data.items) {
				if (update.status === 409) pending.push(Number(update._id));
				else if (update.error) throw Error(JSON.stringify(update.error));
				else updated++;
			}
			if (attempt === 3 && pending.length) throw Error('Concurrent grade updates; retry affected IDs: ' + pending.join(','));
		}
	}
	return updated;
}

module.exports = { VERSION, indexedRows, read, fallbackRows, attach, affected, refresh };
