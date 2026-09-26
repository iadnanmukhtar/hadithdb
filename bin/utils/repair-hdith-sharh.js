#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const util = require('util');
const { execFileSync } = require('child_process');
const { CACHE_DIR, HDITH_LOCAL_BOOKS, fetchSharh, replaceSharh } = require('./import-hdith-six-books-enrichment');

function option(name) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }

async function main() {
	const slug = option('--book');
	const bookId = Number(String(slug || '').replace(/^b-/, ''));
	const config = HDITH_LOCAL_BOOKS[bookId];
	if (!config || !/^b-\d+$/.test(slug || '')) throw new Error('Usage: repair-hdith-sharh.js --book b-N [--apply] [--include-explanations] [--source-ids FILE] [--report FILE]');
	const apply = process.argv.includes('--apply');
	const services = process.argv.includes('--include-explanations') ? [6, 12] : [6];
	const reportFile = option('--report') || path.join(CACHE_DIR, `${slug}-sharh-audit.json`);
	fs.mkdirSync(path.dirname(reportFile), { recursive: true });
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	try {
		const rows = await query(`SELECT h.id,h.num,m.source_entry_id FROM hadiths h
			JOIN hdith_hadith_metadata m ON m.hadith_id=h.id
			WHERE h.bookId=? AND m.source_book_slug=? ORDER BY h.ordinal,h.id`, [config.bookId, slug]);
		const mappedCount = rows.length;
		if (option('--source-ids')) {
			const ids = JSON.parse(fs.readFileSync(option('--source-ids'), 'utf8'));
			if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid source ID list.');
			const mapped = new Set(rows.map(row => Number(row.source_entry_id)));
			for (const id of new Set(ids)) if (!mapped.has(id)) rows.push({ id: null, num: null, source_entry_id: id });
		}
		const stored = await query(`SELECT hs.* FROM hdith_hadith_sharh hs JOIN hadiths h ON h.id=hs.hadith_id WHERE h.bookId=?`, [config.bookId]);
		const report = { sourceBookSlug: slug, services, mappedCount, checked: 0, withSharh: 0, sourceItems: 0, changed: [], failures: [], records: [] };
		const downloaded = new Map();
		let cursor = 0;
		// Bound simultaneous requests. Only downloads run concurrently; writes are serial.
		await Promise.all(Array.from({ length: 4 }, async () => {
			while (cursor < rows.length) {
				const row = rows[cursor++];
				try {
					const items = await fetchSharh(null, { sourceSlug: slug, commentaryServices: services }, row.source_entry_id);
					downloaded.set(row.source_entry_id, items);
					report.checked++;
					if (items.length) report.withSharh++;
					report.sourceItems += items.length;
					report.records.push({ hadithId: row.id, localReference: row.num, sourceEntryId: row.source_entry_id,
						entryIds: items.map(item => item.sourceEntryId) });
				} catch (error) { report.failures.push({ hadithId: row.id, sourceEntryId: row.source_entry_id, error: error.message }); }
				if ((report.checked + report.failures.length) % 100 === 0) {
					console.log(`${slug}: checked ${report.checked}/${rows.length}; ${report.withSharh} with sharh, ${report.sourceItems} passages; failures ${report.failures.length}`);
					fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
				}
			}
		}));
		fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
		if (report.failures.length) throw new Error(`${report.failures.length} sharh service requests failed; no writes performed. See ${reportFile}`);
		if (apply) {
			const pendingFile = `${reportFile}.pending-index.json`;
			const pendingIndex = new Set(fs.existsSync(pendingFile) ? JSON.parse(fs.readFileSync(pendingFile, 'utf8')) : []);
			fs.writeFileSync(`${reportFile}.${Date.now()}.backup.json`, JSON.stringify({ rows: stored }));
			for (const row of rows) {
				if (!row.id) continue;
				const items = downloaded.get(row.source_entry_id);
				const existing = stored.filter(item => item.hadith_id === row.id);
				// Never delete existing authored material based on an empty response.
				if (!items.length || items.every(item => existing.some(old => old.source_entry_id === item.sourceEntryId && old.text === item.text))) continue;
				await query('START TRANSACTION');
				try { await replaceSharh(connection, row.id, items, services); await query('COMMIT'); }
				catch (error) { await query('ROLLBACK'); throw error; }
				report.changed.push(row.id);
				pendingIndex.add(row.id);
				fs.writeFileSync(pendingFile, JSON.stringify([...pendingIndex]));
				if (report.changed.length % 25 === 0) {
					fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
					console.log(`${slug}: saved commentary for ${report.changed.length} hadiths`);
				}
			}
			const indexIds = [...pendingIndex];
			for (let i = 0; i < indexIds.length; i += 100) {
				const batch = indexIds.slice(i, i + 100);
				const stdout = execFileSync(process.execPath, [path.join(__dirname, '../indexEnrichedHadithBatch.js'), batch.join(',')], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
				console.log(stdout.trim());
				for (const id of batch) pendingIndex.delete(id);
				fs.writeFileSync(pendingFile, JSON.stringify([...pendingIndex]));
			}
		}
		fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
		console.log(JSON.stringify({ checked: report.checked, withSharh: report.withSharh, sourceItems: report.sourceItems, changed: report.changed.length, reportFile }));
	} finally { connection.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
