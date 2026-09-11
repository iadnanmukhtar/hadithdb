#!/usr/bin/env node
'use strict';

require('dotenv').config();

const childProcess = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');
const Utils = require('../../lib/Utils');
const { normalizeExistingEnglishTocHeading } = require('../../lib/EnglishTocHeading');

const UPDATE_BATCH_SIZE = 250;

async function main() {
	const apply = readOptions(process.argv.slice(2));
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
	global.settings = settings;
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	let changes;
	try {
		const rows = await query(`SELECT t.id,t.bookId,b.alias,t.title_en
			FROM toc t JOIN books b ON b.id=t.bookId
			WHERE t.title_en IS NOT NULL AND TRIM(t.title_en)<>''
			ORDER BY t.id`);
		changes = rows.map(row => ({ ...row, normalized: normalizeExistingEnglishTocHeading(row.title_en) }))
			.filter(row => row.normalized !== row.title_en);
		const aliases = [...new Set(changes.map(row => row.alias))];
		console.log(`${apply ? 'Updating' : 'Would update'} ${changes.length} English TOC headings across ${aliases.length} books.`);
		for (const row of changes.slice(0, 12))
			console.log(`${row.alias}:${row.id} ${JSON.stringify(row.title_en)} -> ${JSON.stringify(row.normalized)}`);
		if (!apply || !changes.length) return;
		await query('START TRANSACTION');
		for (let offset = 0; offset < changes.length; offset += UPDATE_BATCH_SIZE) {
			const batch = changes.slice(offset, offset + UPDATE_BATCH_SIZE);
			const clauses = batch.map(row => `WHEN ${Number(row.id)} THEN ${mysql.escape(row.normalized)}`).join(' ');
			const ids = batch.map(row => Number(row.id));
			await query(`UPDATE toc SET title_en=CASE id ${clauses} END WHERE id IN (${ids.join(',')})`);
		}
		await query('COMMIT');
	} catch (error) {
		if (apply) await query('ROLLBACK').catch(() => {});
		throw error;
	} finally {
		connection.destroy();
	}
	if (!apply || !changes.length) return;
	const bookIds = [...new Set(changes.map(row => Number(row.bookId)))];
	const aliases = [...new Set(changes.map(row => row.alias))];
	const indexScript = path.resolve(__dirname, '../buildSearchIndex.js');
	for (const bookId of bookIds)
		childProcess.execFileSync(process.execPath, [indexScript, '--book-id', String(bookId), '--toc-only'], { stdio: 'inherit' });
	await RuntimeRefresh.publish();
	for (const alias of aliases) {
		await Utils.flushCacheContaining(alias);
		await Utils.flushCacheContaining(`book:${alias}`);
	}
	console.log(`Updated and refreshed ${changes.length} English TOC headings across ${aliases.length} books.`);
}

function readOptions(args) {
	for (const arg of args)
		if (arg !== '--apply') throw new Error(`Unknown option: ${arg}`);
	return args.includes('--apply');
}

if (require.main === module) {
	main().then(() => process.exit()).catch(error => {
		console.error(error.stack || error);
		process.exit(1);
	});
}

module.exports = { readOptions };
