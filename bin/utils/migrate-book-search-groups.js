#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
const seed = require('./book-search-groups-seed.json');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

async function main() {
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json'), 'utf8'));
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = promisify(connection.query).bind(connection);
	const apply = process.argv.includes('--apply');
	try {
		const hasColumn = (await query("SHOW COLUMNS FROM books LIKE 'search_groups'")).length > 0;
		await query('START TRANSACTION');
		const rows = await query(`SELECT id, alias, properties, ${hasColumn ? 'search_groups' : 'NULL AS search_groups'} FROM books ORDER BY id FOR UPDATE`);
		const missing = seed.flatMap(group => group.aliases.filter(alias => !rows.some(row => row.alias === alias)));
		if (missing.length) throw new Error(`Unknown book aliases: ${[...new Set(missing)].join(', ')}`);
		const updates = [];
		for (const row of rows) {
			const properties = { ...(parse(row.properties) || {}) };
			const existing = properties.searchGroups;
			const column = parse(row.search_groups);
			if (existing != null && !Array.isArray(existing)) throw new Error(`Invalid groups for ${row.alias}`);
			if (column != null && !Array.isArray(column)) throw new Error(`Invalid column groups for ${row.alias}`);
			let groups = existing;
			if (column != null) {
				groups = (existing || []).slice();
				for (const group of column) {
					const current = groups.find(item => item.id === group.id);
					if (current && !isDeepStrictEqual(current, group)) throw new Error(`Conflicting group ${group.id} for ${row.alias}`);
					if (!current) groups.push(group);
				}
			}
			// Retired groups are replaced by their user-requested memberships in the seed.
			groups = (groups || []).filter(group => !['combined-sahihayn', 'tafsir-tajwid', 'tafsir-revelation', 'tafsir-readings', 'tafsir-vocabulary', 'tafsir-grammar'].includes(group.id)).map(group => {
				if (!['tafsir-other', 'tafsir-mukhtasarat'].includes(group.id)) return group;
				const seededGroup = seed.find(item => item.id === group.id);
				return { ...group, label: seededGroup.label, ordinal: seededGroup.ordinal };
			});
			for (const { aliases, memberEvidence, ...group } of seed.filter(group => group.aliases.includes(row.alias))) {
				if (!groups.some(current => current.id === group.id)) groups.push({ ...group, memberOrdinal: aliases.indexOf(row.alias), ...memberEvidence?.[row.alias] });
			}
			if ((groups?.length || existing != null || column != null) && !isDeepStrictEqual(existing, groups)) updates.push({ id: row.id, properties: { ...properties, searchGroups: groups } });
		}
		if (apply && (updates.length || hasColumn)) {
			const backup = path.join(os.tmpdir(), `hadithdb-book-groups-properties-${Date.now()}.json`);
			fs.writeFileSync(backup, JSON.stringify(rows, null, 2));
			console.log(`Backup: ${backup}`);
			for (const row of updates) await query('UPDATE books SET properties=? WHERE id=?', [JSON.stringify(row.properties), row.id]);
		}
		await query(apply ? 'COMMIT' : 'ROLLBACK');
		if (apply && hasColumn) await query('ALTER TABLE books DROP COLUMN search_groups');
		console.log(`${apply ? 'Updated' : 'Would update'} ${updates.length} books in properties.searchGroups; ${hasColumn ? 'temporary column removed on apply' : 'no temporary column'}.`);
	} catch (error) {
		await query('ROLLBACK');
		throw error;
	} finally { connection.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
