#!/usr/bin/env node
'use strict';

// Reuse existing vocalized pairs only; never infer a person's name or vowels.
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const util = require('util');
const { connectionSettings } = require('./initializeHadithAttributions');
const { withoutTashkil } = require('./hdithPrimaryNarratorTashkil');
const hasTashkil = value => /[ً-ٰٟ]/u.test(value || '');

function planRepairs({ narrators, metadata, pairs }) {
	const byId = new Map(narrators.map(n => [n.id, n]));
	const candidates = new Map();
	function add(ar, en) {
		if (!hasTashkil(ar) || !en) return;
		const key = withoutTashkil(ar);
		const values = candidates.get(key) || new Map();
		values.set(JSON.stringify([ar, en]), { ar, en });
		candidates.set(key, values);
	}
	for (const n of narrators) add(n.name_tashkil, n.name_ala_lc);
	for (const m of metadata) add(m.narrator, m.narrator_en);
	const managed = new Map(pairs.filter(p => !p.hidden && hasTashkil(p.value_ar) && p.value_en)
		.map(p => [withoutTashkil(p.value_ar), { ar: p.value_ar, en: p.value_en }]));
	const updates = [], skipped = [];
	for (const row of metadata) {
		if (!row.narrator || hasTashkil(row.narrator)) continue;
		const key = withoutTashkil(row.narrator);
		const identity = byId.get(row.narrator_id);
		let pair = managed.get(key);
		if (!pair && identity?.name_tashkil && identity.name_ala_lc && withoutTashkil(identity.name_tashkil) === key)
			pair = { ar: identity.name_tashkil, en: identity.name_ala_lc };
		const choices = candidates.get(key);
		if (!pair && choices?.size === 1) pair = [...choices.values()][0];
		if (pair) updates.push({ ...row, corrected_ar: pair.ar, corrected_en: pair.en });
		else skipped.push(row);
	}
	return { updates, skipped };
}

async function main() {
	const apply = process.argv.includes('--apply');
	const connection = mysql.createConnection(connectionSettings());
	const query = util.promisify(connection.query).bind(connection);
	try {
		const narrators = await query('SELECT id,source_slug,name,name_tashkil,name_ala_lc FROM hdith_narrators');
		const metadata = await query(`SELECT m.hadith_id,m.narrator,m.narrator_en,hn.narrator_id,b.alias,h.num
			FROM hdith_hadith_metadata m JOIN hadiths h ON h.id=m.hadith_id JOIN books b ON b.id=h.bookId
			LEFT JOIN hdith_hadith_narrators hn ON hn.hadith_id=m.hadith_id AND hn.ordinal=1`);
		const pairs = await query("SELECT * FROM hdith_bilingual_pairs WHERE pair_type='narrator'");
		const plan = planRepairs({ narrators, metadata, pairs });
		console.log(JSON.stringify({ apply, updates: plan.updates.length, skipped: plan.skipped.length,
			books: [...new Set(plan.updates.map(r => r.alias))] }));
		if (!apply || !plan.updates.length) return;
		const backup = path.join(os.homedir(), '.hadithdb', 'backups', `primary-narrator-pairs-${Date.now()}.json`);
		fs.mkdirSync(path.dirname(backup), { recursive: true });
		fs.writeFileSync(backup, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
		console.log(`Backup: ${backup}`);
		await query(`CREATE TEMPORARY TABLE narrator_pair_repair (
			hadith_id INT PRIMARY KEY, old_ar TEXT, old_en TEXT, new_ar TEXT, new_en TEXT
		) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
		for (let i = 0; i < plan.updates.length; i += 500) {
			const batch = plan.updates.slice(i, i + 500);
			await query('INSERT INTO narrator_pair_repair VALUES ?', [batch.map(r =>
				[r.hadith_id, r.narrator, r.narrator_en, r.corrected_ar, r.corrected_en])]);
		}
		await query('START TRANSACTION');
		try {
			const result = await query(`UPDATE hdith_hadith_metadata m JOIN narrator_pair_repair r ON r.hadith_id=m.hadith_id
				SET m.narrator=r.new_ar,m.narrator_en=r.new_en
				WHERE BINARY m.narrator <=> BINARY r.old_ar AND BINARY m.narrator_en <=> BINARY r.old_en`);
			const [check] = await query(`SELECT COUNT(*) AS remaining FROM hdith_hadith_metadata m
				JOIN narrator_pair_repair r ON r.hadith_id=m.hadith_id
				WHERE NOT (BINARY m.narrator <=> BINARY r.new_ar) OR NOT (BINARY m.narrator_en <=> BINARY r.new_en)`);
			if (check.remaining) throw new Error(`${check.remaining} rows failed verification; rolling back`);
			await query('COMMIT');
			console.log(`Updated and verified ${result.affectedRows} rows.`);
		} catch (error) { await query('ROLLBACK'); throw error; }
		global.query = query;
		const Utils = require('../lib/Utils');
		for (const alias of new Set(plan.updates.map(r => r.alias)))
			console.log(JSON.stringify(await Utils.flushBookDiskCache(alias, { strict: true })));
		await require('../lib/RuntimeRefresh').publish();
	} finally { await util.promisify(connection.end).call(connection); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { planRepairs };
