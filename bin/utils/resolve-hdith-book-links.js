#!/usr/bin/env node
'use strict';
// Run after a gap repair using --defer-similar-links. Rebuilds only imported
// relationships touching this collection; manually confirmed pairs are retained.
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const mysql = require('mysql');
const { CACHE_DIR, HDITH_LOCAL_BOOKS, localTargetsForHdithLinks } = require('./import-hdith-six-books-enrichment');
function option(name) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }
async function main() {
	const sourceBookId = Number(String(option('--book') || '').replace(/^b-/, ''));
	const config = HDITH_LOCAL_BOOKS[sourceBookId];
	if (!config) throw new Error('Usage: resolve-hdith-book-links.js --book b-N [--apply] [--report FILE]');
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	try {
		const hadithIds = (await query('SELECT id FROM hadiths WHERE bookId=?', [config.bookId])).map(row => row.id);
		const links = await query(`SELECT id,hadith_id,source_book_id,source_entry_id,source_num,internal_hadith_id,internal_ref
			FROM hdith_hadith_links WHERE link_type='similar' AND (hadith_id IN (?) OR source_book_id=?) ORDER BY id`, [hadithIds, sourceBookId]);
		const targets = new Map();
		for (let offset = 0; offset < links.length; offset += 5000)
			for (const [id, target] of await localTargetsForHdithLinks(connection, links.slice(offset, offset + 5000))) targets.set(id, target);
		const updates = [], pairs = new Map();
		for (const link of links) {
			const target = targets.get(Number(link.id));
			// For the selected collection, unresolved drifting source numbers must
			// remain external. Leave unrelated, previously saved targets intact.
			const id = target?.id ?? (Number(link.source_book_id) === sourceBookId ? null : link.internal_hadith_id);
			const ref = target ? `${target.alias}:${target.num}` : id ? link.internal_ref : null;
			if (id !== link.internal_hadith_id || ref !== link.internal_ref) updates.push({ old: link, id, ref });
			if (id && Number(id) !== Number(link.hadith_id)) {
				const pair = [Number(link.hadith_id), Number(id)].sort((a, b) => a - b);
				pairs.set(pair.join(':'), pair);
			}
		}
		const oldPairs = await query(`SELECT * FROM hadiths_sim WHERE (hadithId1 IN (?) OR hadithId2 IN (?))
			AND similarity_source='hdith.com' AND similarity_imported=1`, [hadithIds, hadithIds]);
		const oldMapping = await query('SELECT * FROM hdith_book_mappings WHERE source_book_id=?', [sourceBookId]);
		const stalePairs = oldPairs.filter(pair => !pairs.has(`${pair.hadithId1}:${pair.hadithId2}`));
		const existingPairs = new Set(oldPairs.map(pair => `${pair.hadithId1}:${pair.hadithId2}`));
		const reportFile = option('--report') || path.join(CACHE_DIR, `b-${sourceBookId}-resolved-links.json`);
		fs.mkdirSync(path.dirname(reportFile), { recursive: true });
		const report = { sourceBookId, checked: links.length, changedLinks: updates.length, previousImportedPairs: oldPairs.length,
			removedImportedPairs: stalePairs.length, confirmedPairs: pairs.size, applied: false };
		fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
		if (process.argv.includes('--apply')) {
			fs.writeFileSync(`${reportFile}.${Date.now()}.backup.json`, JSON.stringify({ links: updates.map(item => item.old), pairs: oldPairs, mapping: oldMapping }));
			await query('START TRANSACTION');
			try {
				for (let offset = 0; offset < updates.length; offset += 500) {
					const batch = updates.slice(offset, offset + 500), cases = batch.map(() => 'WHEN ? THEN ?').join(' ');
					await query(`UPDATE hdith_hadith_links SET internal_hadith_id=CASE id ${cases} END,
						internal_ref=CASE id ${cases} END WHERE id IN (?)`,
					[...batch.flatMap(item => [item.old.id, item.id]), ...batch.flatMap(item => [item.old.id, item.ref]), batch.map(item => item.old.id)]);
				}
				for (let offset = 0; offset < stalePairs.length; offset += 500)
					await query(`DELETE FROM hadiths_sim WHERE (hadithId1,hadithId2) IN (?)
						AND similarity_source='hdith.com' AND similarity_imported=1`,
					[stalePairs.slice(offset, offset + 500).map(pair => [pair.hadithId1, pair.hadithId2])]);
				const values = [...pairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
				for (let offset = 0; offset < values.length; offset += 1000) {
					const batch = values.slice(offset, offset + 1000);
					const missing = batch.filter(pair => !existingPairs.has(pair.join(':')));
					if (missing.length) await query('INSERT IGNORE INTO hadiths_sim (hadithId1,hadithId2,similarity_source,similarity_imported) VALUES ?', [missing.map(pair => [...pair, 'hdith.com', 1])]);
					await query('DELETE FROM hadiths_sim_candidates WHERE (hadithId1,hadithId2) IN (?)', [batch]);
					await query('DELETE FROM hadiths_sim_candidates WHERE (hadithId1,hadithId2) IN (?)', [batch.map(pair => [pair[1], pair[0]])]);
				}
				await query('UPDATE hdith_book_mappings SET reference_mode=? WHERE source_book_id=?', [config.referenceMode, sourceBookId]);
				await query('COMMIT');
			} catch (error) { await query('ROLLBACK'); throw error; }
			report.applied = true;
			fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
		}
		console.log(report);
	} finally { connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
