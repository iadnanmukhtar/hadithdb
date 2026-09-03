#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');

const ids = [...new Set(process.argv.slice(2).flatMap(value => value.split(','))
	.map(value => Number(value)).filter(value => Number.isSafeInteger(value) && value > 0))];
const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
const connection = mysql.createConnection(settings.mysql.connection);
const query = util.promisify(connection.query).bind(connection);

(async () => {
	try {
		if (!ids.length) throw new Error('At least one valid hadith ID is required.');
		const idList = ids.join(',');
		const rows = await query(`SELECT h.id AS hId, h.chain, h.chain_en, h.body, h.footnote, h.body_start, h.hasSupplementaryTransmissions,
			h.bookId AS _bookId, book.alias AS _bookAlias
			FROM hadiths h JOIN books book ON book.id=h.bookId
			WHERE h.id IN (${idList}) ORDER BY h.id`);
		rows.forEach(row => { row.hasSupplementaryTransmissions = Boolean(row.hasSupplementaryTransmissions); });
		await attachNavigation(rows);
		await attachSharh(rows, idList);
		await attachGrades(rows, idList);
		await ensureLiveMapping();
		await updatePartial(rows);
		console.log(`indexed ${rows.length}/${ids.length} enriched hadith(s)`);
	} finally {
		connection.end();
	}
})().catch(err => {
	console.error(err.stack || err.message);
	process.exitCode = 1;
});

async function attachSharh(rows, idList) {
	const source = await query(`SELECT hs.hadith_id, hs.text, hs.text_en,
		COALESCE(NULLIF(hs.title_en, ''), NULLIF(hs.title, ''), ss.title_en, ss.title) AS title, ss.author
		FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		WHERE hs.hadith_id IN (${idList}) ORDER BY hs.hadith_id, hs.id`);
	const grouped = groupByHadith(source);
	rows.forEach(row => {
		row.sharh = (grouped.get(Number(row.hId)) || []).map(item =>
			`${item.title}${item.author ? ` — ${item.author}` : ''}\n${item.text_en || item.text}`).join('\n\n');
	});
}

async function attachNavigation(rows) {
	const bookIds = [...new Set(rows.map(row => Number(row._bookId)).filter(Number.isSafeInteger))];
	if (!bookIds.length) return;
	const ordered = await query(`SELECT id, bookId, num FROM hadiths
		WHERE remark<>2 AND bookId IN (${bookIds.join(',')}) ORDER BY bookId, ordinal, id`);
	const positions = new Map(ordered.map((row, index) => [Number(row.id), index]));
	rows.forEach(row => {
		const position = positions.get(Number(row.hId));
		const previous = position == null ? null : ordered[position - 1];
		const next = position == null ? null : ordered[position + 1];
		row.prevId = previous && Number(previous.bookId) === Number(row._bookId) ? Number(previous.id) : null;
		row.prev_ref = row.prevId ? `${row._bookAlias}:${previous.num}` : null;
		row.nextId = next && Number(next.bookId) === Number(row._bookId) ? Number(next.id) : null;
		row.next_ref = row.nextId ? `${row._bookAlias}:${next.num}` : null;
		delete row._bookId;
		delete row._bookAlias;
	});
}

async function attachGrades(rows, idList) {
	const source = await query(`SELECT hadith_id, source_slug, grader, grade, grade_category_id,
		source_name, book_page, source_url FROM hdith_hadith_grades
		WHERE hadith_id IN (${idList}) ORDER BY hadith_id, ordinal`);
	const grouped = groupByHadith(source);
	rows.forEach(row => {
		row.grader_opinions = (grouped.get(Number(row.hId)) || []).map(item => ({
			source_slug: item.source_slug, grader: item.grader, grade: item.grade,
			grade_category_id: item.grade_category_id, source: item.source_name,
			book_page: item.book_page, source_url: item.source_url
		}));
	});
}

async function ensureLiveMapping() {
	const mappingUrl = `${settings.search.domain}/hadiths/_mapping`;
	const response = await withSearchRetry(() => axios.get(mappingUrl, searchConfig({ timeout: 30000 })), 'read live mapping');
	const properties = Object.values(response.data || {})[0]?.mappings?.properties || {};
	if (properties.body_start && properties.hasSupplementaryTransmissions) return;
	await withSearchRetry(() => axios.put(mappingUrl, { properties: {
		body_start: { type: 'text', boost: 2, analyzer: 'arabic' },
		hasSupplementaryTransmissions: { type: 'boolean' }
	} }, searchConfig({ timeout: 60000 })), 'update live mapping');
}

async function updatePartial(rows) {
	let bulk = '';
	let count = 0;
	for (const row of rows) {
		bulk += `${JSON.stringify({ update: { _index: 'hadiths', _id: row.hId } })}\n`;
		bulk += `${JSON.stringify({ doc: row })}\n`;
		bulk += `${JSON.stringify({ update: { _index: 'hadiths', _id: row.hId } })}\n`;
		bulk += `${JSON.stringify({ script: { source: "ctx._source.remove('tarf')" } })}\n`;
		count++;
		if (count >= 25 || Buffer.byteLength(bulk, 'utf8') >= 2 * 1024 * 1024) {
			await postBulk(bulk);
			bulk = '';
			count = 0;
		}
	}
	if (bulk) await postBulk(bulk);
}

async function postBulk(body) {
	const compressed = zlib.gzipSync(Buffer.from(body, 'utf8'));
	const response = await withSearchRetry(() => axios.post(`${settings.search.domain}/hadiths/_bulk`, compressed, searchConfig({
		headers: { 'Content-Type': 'application/x-ndjson', 'Content-Encoding': 'gzip' }, timeout: 120000, maxBodyLength: Infinity
	})), 'bulk update');
	if (response.data?.errors) {
		const failure = (response.data.items || []).flatMap(item => Object.values(item)).find(item => item.error);
		throw new Error(`Elasticsearch bulk update failed: ${JSON.stringify(failure?.error || response.data)}`);
	}
}

async function withSearchRetry(operation, label) {
	let lastError;
	for (let attempt = 1; attempt <= 5; attempt++) {
		try { return await operation(); }
		catch (err) {
			lastError = err;
			const status = Number(err?.response?.status);
			if (![429, 502, 503, 504].includes(status) || attempt === 5) throw err;
			const delay = Math.min(8000, 500 * (2 ** (attempt - 1)));
			console.warn(`search: ${label} returned HTTP ${status}; retrying ${attempt + 1}/5 after ${delay} ms`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	throw lastError;
}

function searchConfig(extra = {}) {
	const username = settings.search.username || settings.search.user;
	const password = settings.search.password || settings.search.pass;
	return Object.assign({}, username ? { auth: { username: String(username), password: password == null ? '' : String(password) } } : {}, extra);
}

function groupByHadith(rows) {
	const grouped = new Map();
	for (const row of rows) {
		const id = Number(row.hadith_id);
		if (!grouped.has(id)) grouped.set(id, []);
		grouped.get(id).push(row);
	}
	return grouped;
}
