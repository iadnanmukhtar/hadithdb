#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const {
	CACHE_DIR, HDITH_LOCAL_BOOKS, enrichHadithMatches, fetchProps, hadithPrefixSimilarity,
	hadithTextSimilarity, normalizeHadithForComparison, referencesEquivalent, startLightpanda
} = require('./import-hdith-six-books-enrichment');

const apply = process.argv.includes('--apply');
const requested = option('--books');
const sourceBookIds = requested ? requested.split(',').map(value => Number(value.replace(/^b-/, ''))).filter(Number.isInteger) : [];

function option(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

function compact(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function uniqueSummaries(props) {
	const values = [...(props.hadiths || []), ...(props.hadith_groups || []).flatMap(group => group.hadiths || [])];
	const byId = new Map();
	for (const value of values) if (value?.id && value.kind === 'hadith') byId.set(Number(value.id), value);
	return [...byId.values()];
}

function scoreSummary(summary, local) {
	const source = normalizeHadithForComparison(summary.text || summary.tarf);
	if (!source) return 0;
	const combined = normalizeHadithForComparison([local.chain, local.body].filter(Boolean).join(' '));
	const body = normalizeHadithForComparison(local.body);
	return Math.max(hadithPrefixSimilarity(source, combined), hadithPrefixSimilarity(source, body),
		hadithTextSimilarity(source, combined), hadithTextSimilarity(source, body));
}

function matchSummaries(sourceBookId, summaries, locals) {
	const sourceSlug = `b-${sourceBookId}`;
	const exactReferences = HDITH_LOCAL_BOOKS[sourceBookId].referenceMode === 'exact';
	const used = new Set();
	const matched = [];
	const ambiguous = [];
	let cursor = 0;
	for (const summary of summaries.sort((left, right) => Number(left.id) - Number(right.id))) {
		let indexes = [];
		if (exactReferences && summary.n) {
			indexes = locals.map((local, index) => ({ local, index })).filter(({ local }) =>
				!used.has(Number(local.id)) && referencesEquivalent(compact(summary.n), local.num, sourceSlug)).map(item => item.index);
		}
		if (!indexes.length) {
			for (let index = cursor; index < Math.min(locals.length, cursor + 180); index++)
				if (!used.has(Number(locals[index].id))) indexes.push(index);
		}
		const ranked = indexes.map(index => ({ index, local: locals[index], score: scoreSummary(summary, locals[index]) }))
			.sort((left, right) => right.score - left.score || left.index - right.index);
		const threshold = sourceSlug === 'b-24' ? 0.80 : 0.90;
		if (!ranked[0] || ranked[0].score < threshold) continue;
		if (ranked[1] && ranked[1].score >= threshold && ranked[0].score - ranked[1].score < 0.015) {
			ambiguous.push({ sourceEntryId: Number(summary.id), sourceReference: compact(summary.n),
				choices: ranked.slice(0, 3).map(item => ({ localReference: item.local.num, score: item.score })) });
			continue;
		}
		used.add(Number(ranked[0].local.id));
		cursor = Math.max(cursor, ranked[0].index + 1);
		matched.push({ sourceBookId, sourceEntryId: Number(summary.id), localHadithId: Number(ranked[0].local.id),
			localReference: ranked[0].local.num, summaryScore: ranked[0].score });
	}
	return { matched, ambiguous, unmatchedLocals: locals.filter(local => !used.has(Number(local.id))) };
}

async function main() {
	if (!sourceBookIds.length || sourceBookIds.some(id => !HDITH_LOCAL_BOOKS[id]))
		throw new Error('Usage: repair-hdith-enrichment-gaps.js --books b-N,b-N [--apply]');
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql.connection;
	const connection = mysql.createConnection(settings);
	const query = util.promisify(connection.query).bind(connection);
	let browser;
	try {
		browser = await startLightpanda();
		const page = await browser.context.newPage();
		for (const sourceBookId of sourceBookIds) {
			const config = HDITH_LOCAL_BOOKS[sourceBookId];
			const slug = `b-${sourceBookId}`;
			const locals = await query(`SELECT h.id,h.num,h.chain,h.body,h.ordinal FROM hadiths h
				LEFT JOIN hdith_hadith_metadata m ON m.hadith_id=h.id
				WHERE h.bookId=? AND m.hadith_id IS NULL ORDER BY h.ordinal,h.id`, [config.bookId]);
			const mappedRows = await query('SELECT source_entry_id FROM hdith_book_reference_crosswalk WHERE source_book_id=?', [sourceBookId]);
			const mapped = new Set(mappedRows.map(row => Number(row.source_entry_id)));
			const book = await fetchProps(page, `/encyclopedia/book/${slug}`, path.join(CACHE_DIR, slug, '_book.json.gz'));
			const summaries = new Map();
			for (const chapter of book.chapters || []) {
				const props = await fetchProps(page, `/encyclopedia/book/${slug}?chapter=${chapter.id}`,
					path.join(CACHE_DIR, slug, '_chapters', `${chapter.id}.json.gz`));
				for (const summary of uniqueSummaries(props)) if (!mapped.has(Number(summary.id))) summaries.set(Number(summary.id), summary);
			}
			const result = matchSummaries(sourceBookId, [...summaries.values()], locals);
			console.log(`${config.alias}: ${locals.length} local gaps, ${summaries.size} unmapped source candidates, ${result.matched.length} confident summary matches, ${result.ambiguous.length} ambiguous.`);
			if (result.ambiguous.length) console.log(`${config.alias}: ambiguous ${JSON.stringify(result.ambiguous.slice(0, 20))}`);
			if (apply && result.matched.length) {
				const applied = await enrichHadithMatches(result.matched);
				console.log(`${config.alias}: applied ${applied.applied.length}; rejected by full detail confirmation ${applied.rejected.length}.`);
				if (applied.rejected.length) console.log(`${config.alias}: rejected ${JSON.stringify(applied.rejected.slice(0, 20))}`);
			}
		}
	} finally {
		if (browser) await browser.close();
		connection.end();
	}
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { matchSummaries, scoreSummary, uniqueSummaries };
