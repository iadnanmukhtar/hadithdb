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
	CACHE_DIR, HDITH_LOCAL_BOOKS, editionReferencesEquivalent, enrichHadithMatches, fetchProps, fullRecordMatchScore, loadRecord, hadithPrefixSimilarity,
	hadithTextSimilarity, normalizeHadithForComparison, referencesEquivalent, reviewedIdentityIsCurrent, startLightpanda
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
				!used.has(Number(local.id)) && referencesEquivalent(sourceSlug, local.num, compact(summary.n))).map(item => item.index);
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

// Top-level source listings can stop at 400 entries. Read their subchapters
// (including the partially returned boundary group), then fail closed if the
// declared chapter count still cannot be accounted for.
async function collectChapterSummaries(chapter, fetchChapter) {
	const props = await fetchChapter(chapter.id);
	const summaries = new Map(uniqueSummaries(props).map(item => [Number(item.id), item]));
	const expected = Number(chapter.count);
	const visited = new Set([Number(chapter.id)]);
	const queue = [...(props.hadith_groups || [])];
	while (summaries.size < expected && queue.length) {
		const group = queue.shift();
		if (!Number(group.id) || visited.has(Number(group.id))) continue;
		visited.add(Number(group.id));
		const child = await fetchChapter(group.id);
		for (const item of uniqueSummaries(child)) summaries.set(Number(item.id), item);
		queue.push(...(child.hadith_groups || []));
	}
	if (summaries.size !== expected)
		throw new Error(`Chapter ${chapter.id}: found ${summaries.size}/${expected} source hadiths; refusing an incomplete repair.`);
	return [...summaries.values()];
}

function matchFullRecords(sourceBookId, records, locals) {
	const sourceSlug = `b-${sourceBookId}`;
	const matched = [], ambiguous = [], used = new Set();
	for (const record of records) {
		if (record.isIntro) continue;
		// Full details contain the edition reference; summary display numbers can
		// drift. Do not fall back to a different reference for an automatic repair.
		const candidates = locals.filter(local => editionReferencesEquivalent(sourceSlug, local.num, record.editionReference || record.num));
		const ranked = candidates.map(local => ({ local, score: fullRecordMatchScore(record, local, sourceSlug) }))
			.filter(item => item.score >= (sourceSlug === 'b-24' ? 0.80 : 0.90))
			.sort((a, b) => b.score - a.score);
		if (!ranked.length) continue;
		if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.015) {
			ambiguous.push({ sourceEntryId: record.sourceId, reason: 'multiple local matches' }); continue;
		}
		const best = ranked[0];
		if (used.has(best.local.id)) {
			// Two source entries claiming one local record require manual review.
			const index = matched.findIndex(item => item.localHadithId === best.local.id);
			if (index >= 0) ambiguous.push({ ...matched.splice(index, 1)[0], reason: 'multiple source matches' });
			ambiguous.push({ sourceEntryId: record.sourceId, localHadithId: best.local.id, reason: 'multiple source matches' });
			continue;
		}
		used.add(best.local.id);
		matched.push({ sourceBookId, sourceEntryId: record.sourceId, localHadithId: best.local.id,
			localReference: best.local.num, score: best.score });
	}
	const matchedIds = new Set(matched.map(item => item.localHadithId));
	return { matched, ambiguous, unmatchedLocals: locals.filter(local => !matchedIds.has(local.id)) };
}

async function main() {
	if (!sourceBookIds.length || sourceBookIds.some(id => !HDITH_LOCAL_BOOKS[id]))
		throw new Error('Usage: repair-hdith-enrichment-gaps.js --books b-N,b-N [--apply] [--skip-schema] [--report FILE] [--reviewed FILE]');
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
				const complete = await collectChapterSummaries(chapter, id => fetchProps(page,
					`/encyclopedia/book/${slug}?chapter=${id}`, path.join(CACHE_DIR, slug, '_chapters', `${id}.json.gz`)));
				for (const summary of complete) summaries.set(Number(summary.id), summary);
				console.log(`${config.alias}: chapter ${chapter.id}: ${complete.length}/${chapter.count} source entries`);
			}
			if (Number(book.stats?.hadiths) && summaries.size !== Number(book.stats.hadiths))
				throw new Error(`${slug}: found ${summaries.size}/${book.stats.hadiths} source entries.`);
			const records = [];
			for (const summary of summaries.values()) {
				if (mapped.has(Number(summary.id))) continue;
				records.push(await loadRecord(page, { ...config, sourceSlug: slug }, Number(summary.id)));
				if (records.length % 25 === 0) console.log(`${config.alias}: checked ${records.length} full source records`);
			}
			const result = matchFullRecords(sourceBookId, records, locals);
			if (option('--reviewed')) {
				const reviewed = JSON.parse(fs.readFileSync(option('--reviewed'), 'utf8'));
				const available = new Set(records.map(record => record.sourceId));
				const localIds = new Set(locals.map(local => local.id));
				result.matched = reviewed.filter(item => item.sourceBookId === sourceBookId
					&& available.has(item.sourceEntryId) && localIds.has(item.localHadithId));
				for (const item of result.matched) {
					const record = records.find(record => record.sourceId === item.sourceEntryId);
					const local = locals.find(local => local.id === item.localHadithId);
					if (!reviewedIdentityIsCurrent(item, record, local))
						throw new Error(`Reviewed identity ${slug}/${item.sourceEntryId} is missing evidence or has changed since review.`);
				}
				if (new Set(result.matched.map(item => item.localHadithId)).size !== result.matched.length
					|| new Set(result.matched.map(item => item.sourceEntryId)).size !== result.matched.length)
					throw new Error('Reviewed identities must be one-to-one.');
				result.unmatchedLocals = locals.filter(local => !result.matched.some(item => item.localHadithId === local.id));
			}
			const reportFile = option('--report') || path.join(CACHE_DIR, `${slug}-gap-repair.json`);
			fs.mkdirSync(path.dirname(reportFile), { recursive: true });
			const report = { sourceBookId, sourceCount: summaries.size, localGaps: locals.length, sourceCandidates: records.length, ...result };
			fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
			console.log(`${config.alias}: ${locals.length} local gaps, ${records.length} unmapped source candidates, ${result.matched.length} ${option('--reviewed') ? 'reviewed' : 'full-detail'} matches, ${result.ambiguous.length} ambiguous. Report: ${reportFile}`);
			if (result.ambiguous.length) console.log(`${config.alias}: ambiguous ${JSON.stringify(result.ambiguous.slice(0, 20))}`);
			if (apply && result.matched.length) {
				const backup = { createdAt: new Date().toISOString(), matches: result.matched, tables: {} };
				const ids = result.matched.map(item => item.localHadithId);
				backup.tables.hadiths = await query('SELECT * FROM hadiths WHERE id IN (?)', [ids]);
				backup.tables.hadiths_tags = await query('SELECT * FROM hadiths_tags WHERE hadithId IN (?)', [ids]);
				for (const table of ['metadata', 'narrators', 'subjects', 'links', 'sharh', 'grades'])
					backup.tables[`hdith_hadith_${table}`] = await query(`SELECT * FROM hdith_hadith_${table} WHERE hadith_id IN (?)`, [ids]);
				backup.tables.hdith_book_reference_crosswalk = await query('SELECT * FROM hdith_book_reference_crosswalk WHERE local_hadith_id IN (?)', [ids]);
				const backupFile = `${reportFile}.${Date.now()}.backup.json`;
				fs.writeFileSync(backupFile, JSON.stringify(backup));
				console.log(`${config.alias}: saved before-repair backup ${backupFile}`);
				const applied = await enrichHadithMatches(result.matched, { gapsOnly: true, allowReviewed: !!option('--reviewed'),
					skipSchema: process.argv.includes('--skip-schema'), onApplied: item => {
						fs.appendFileSync(`${reportFile}.applied.jsonl`, `${JSON.stringify(item)}\n`);
						console.log(`${config.alias}:${item.localReference}: enriched from ${item.sourceEntryId}`);
					} });
				fs.writeFileSync(reportFile, JSON.stringify({ ...report, applied }, null, 2));
				console.log(`${config.alias}: applied ${applied.applied.length}; rejected by full detail confirmation ${applied.rejected.length}.`);
				if (applied.rejected.length) console.log(`${config.alias}: rejected ${JSON.stringify(applied.rejected.slice(0, 20))}`);
			}
		}
	} finally {
		if (browser) await browser.close();
		if (connection.state === 'disconnected') connection.destroy();
		else connection.end();
	}
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { collectChapterSummaries, matchFullRecords, matchSummaries, scoreSummary, uniqueSummaries };
