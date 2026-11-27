'use strict';

const { createHash } = require('crypto');
const SearchHttp = require('./SearchHttp');
const debug = require('./Debug')('hadithdb:GraderDictionary');
const { promisify } = require('util');
let current;
let refreshing;
let timer;

function approvedSpelling(arabic, english) {
	if (arabic === 'المباركفوري' && (!english || english === 'Mubarakpūri')) return 'Mubārakpūrī';
	return english;
}

function build(graders, variants, aliases = []) {
	const legacy = new Map();
	for (const row of graders) {
		const matches = legacy.get(row.shortName) || [];
		matches.push(row);
		legacy.set(row.shortName, matches);
	}
	const byId = new Map(graders.map(row => [row.id, row]));
	for (const alias of aliases) {
		const grader = byId.get(alias.grader_id);
		if (!grader) continue;
		const matches = legacy.get(alias.old_name) || [];
		if (!matches.includes(grader)) matches.push(grader);
		legacy.set(alias.old_name, matches);
	}
	const sources = new Map();
	for (const row of variants) {
		if (row.sourceId == null) continue;
		const ids = sources.get(row.ar) || new Set();
		ids.add(row.sourceId);
		sources.set(row.ar, ids);
	}
	const people = new Map();
	for (const row of graders) {
		const id = 'grader:' + row.id;
		people.set(id, { id, arabic: row.shortName, english: approvedSpelling(row.shortName, row.shortName_en) || '', full: row.name_en || '', keys: [] });
	}
	const seen = new Set();
	const ambiguous = new Set();
	for (const row of variants) {
		const matches = legacy.get(row.ar) || [];
		const sourceIds = sources.get(row.ar);
		const source = row.sourceId ?? (sourceIds?.size === 1 ? [...sourceIds][0] : null);
		const id = matches.length === 1 && !(sourceIds?.size > 1) ? 'grader:' + matches[0].id :
			source == null ? 'label:' + row.ar : 'source:' + source;
		if (!people.has(id)) people.set(id, { id, arabic: row.ar, english: '', full: '', keys: [] });
		const entry = people.get(id);
		const key = JSON.stringify([row.sourceId, row.ar]);
		if (!seen.has(key)) entry.keys.push(key);
		seen.add(key);
		const english = approvedSpelling(row.ar, row.en);
		if (entry.english && english && entry.english !== english && !id.startsWith('grader:')) ambiguous.add(id);
		if (!entry.english && english) entry.english = english;
	}
	for (const id of ambiguous) people.get(id).english = '';
	return [...people.values()];
}

async function readIndex(url, revision) {
	try {
		const response = await SearchHttp.post(url + '/_search', {
			size: 10000, track_total_hits: true, query: { match_all: {} }
		});
		const hits = response.data.hits;
		if (!hits.hits.length || hits.total.value !== hits.hits.length) return null;
		const docs = hits.hits.map(hit => hit._source);
		return docs.every(doc => doc.revision === revision && doc.count === docs.length) ? docs : null;
	} catch (error) {
		if (error.response?.status === 404) return null;
		throw error;
	}
}

async function writeIndex(url, entries, revision) {
	if (!entries.length || entries.length > 10000) throw new Error('Invalid grader dictionary size');
	const lines = [];
	for (const entry of entries) {
		const id = createHash('sha256').update(entry.id).digest('hex');
		lines.push(JSON.stringify({ index: { _id: id } }),
			JSON.stringify({ ...entry, revision, count: entries.length }));
	}
	const response = await SearchHttp.post(url + '/_bulk?refresh=true', lines.join('\n') + '\n',
		{ headers: { 'Content-Type': 'application/x-ndjson' } });
	if (response.data.errors) throw new Error('Incomplete grader dictionary bulk write');
	await SearchHttp.post(url + '/_delete_by_query?refresh=true', { query: { range: { revision: { lt: revision } } } });
}

async function refresh() {
	const [state] = await global.query('SELECT revision FROM grader_dictionary_state WHERE id=1');
	const revision = Number(state.revision);
	if (current?.revision === revision) return;
	const url = global.settings.search.domain + '/grader_dictionary';
	let docs = await readIndex(url, revision);
	if (!docs) {
		const conn = await promisify(global.dbPool.getConnection).call(global.dbPool);
		const query = promisify(conn.query).bind(conn);
		let locked = false;
		try {
			const [lock] = await query("SELECT GET_LOCK('hadithdb.grader_dictionary',0) acquired");
			locked = Boolean(lock.acquired);
			if (!locked) return;
			const graders = await query('SELECT id,shortName,shortName_en,name_en FROM graders ORDER BY id');
			const variants = await query(`SELECT grader_source_id sourceId, ANY_VALUE(grader) ar, ANY_VALUE(grader_en) en
				FROM hdith_hadith_grades GROUP BY grader_source_id,BINARY grader,BINARY grader_en ORDER BY MIN(id)`);
			const aliases = await query('SELECT grader_id,old_name FROM grader_dictionary_alias');
			const entries = build(graders, variants, aliases);
			const [latest] = await query('SELECT revision FROM grader_dictionary_state WHERE id=1');
			if (Number(latest.revision) !== revision) return;
			await writeIndex(url, entries, revision);
			docs = await readIndex(url, revision);
			if (!docs) throw new Error('Grader dictionary verification failed');
		} finally {
			try { if (locked) await query("SELECT RELEASE_LOCK('hadithdb.grader_dictionary')"); }
			finally { conn.release(); }
		}
	}
	current = { revision, entries: new Map(docs.flatMap(entry => entry.keys.map(key => [key, entry]))) };
	debug.info(`Loaded grader dictionary revision ${revision} with ${docs.length} entries`);
}

function start() {
	if (timer || global.settings?.search?.graderDictionaryEnabled !== true) return;
	const tick = () => {
		if (!refreshing) refreshing = refresh().catch(error => {
			current = undefined;
			debug.error('Grader dictionary refresh failed: ' + error.message);
		}).finally(() => { refreshing = undefined; });
	};
	tick();
	timer = setInterval(tick, 10000);
	timer.unref();
}

function attach(rows, dictionary) {
	if (!dictionary) return;
	for (const row of rows) {
		const entry = dictionary.entries.get(JSON.stringify([row.grader_source_id, row.grader]));
		row.grader = entry?.arabic || row.grader;
		row.grader_en = entry?.english || row.grader_en;
		row.grader_name_en = entry?.full || null;
		delete row.grader_source_id;
	}
}

module.exports = { approvedSpelling, build, attach, start, snapshot: () => current };
