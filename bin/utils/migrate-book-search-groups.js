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
	const requested = process.argv.find(arg => arg.startsWith('--group='));
	const selected = requested ? seed.filter(group => group.id === requested.slice(8)) : seed;
	try {
		if (!selected.length) throw new Error('Unknown group: ' + requested);
		const hasColumn = !requested && (await query("SHOW COLUMNS FROM books LIKE 'search_groups'")).length > 0;
		await query('START TRANSACTION');
		const rows = await query(`SELECT id, alias, properties, ${hasColumn ? 'search_groups' : 'NULL AS search_groups'} FROM books ${requested ? 'WHERE alias IN (?)' : ''} ORDER BY id FOR UPDATE`, requested ? [selected[0].aliases] : []);
		const missing = selected.flatMap(group => group.aliases.filter(alias => !rows.some(row => row.alias === alias)));
		if (missing.length) throw new Error(`Unknown book aliases: ${[...new Set(missing)].join(', ')}`);
		const updates = [];
		for (const row of rows) {
			const properties = { ...(parse(row.properties) || {}) };
			const existing = properties.searchGroups;
			const column = parse(row.search_groups);
			if (existing != null && !Array.isArray(existing)) throw new Error(`Invalid groups for ${row.alias}`);
			if (column != null && !Array.isArray(column)) throw new Error(`Invalid column groups for ${row.alias}`);
			let groups = (existing || []).slice();
			if (column != null) {
				for (const group of column) {
					const current = groups.find(item => item.id === group.id);
					if (current && !isDeepStrictEqual(current, group)) throw new Error(`Conflicting group ${group.id} for ${row.alias}`);
					if (!current) groups.push(group);
				}
			}
			// Retired groups are replaced by their user-requested memberships in the seed.
			if (!requested) groups = groups.filter(group => !['hadith-adab', 'hadith-zuhd', 'combined-sahihayn', 'tafsir-tajwid', 'tafsir-revelation', 'tafsir-readings', 'tafsir-vocabulary', 'tafsir-grammar'].includes(group.id)).map(group => {
				if (!['tafsir-other', 'tafsir-mukhtasarat'].includes(group.id)) return group;
				const seededGroup = seed.find(item => item.id === group.id);
				return { ...group, label: seededGroup.label, ordinal: seededGroup.ordinal };
			});
			for (const { aliases, memberEvidence, ...group } of selected.filter(group => group.aliases.includes(row.alias))) {
				const index = groups.findIndex(current => current.id === group.id);
				const memberOrdinal = aliases.indexOf(row.alias);
				if (index === -1) groups.push({ ...group, memberOrdinal, ...memberEvidence?.[row.alias] });
				else if (requested) groups[index] = { ...groups[index], memberOrdinal };
			}
			if ((groups?.length || existing != null || column != null) && !isDeepStrictEqual(existing, groups)) updates.push({ id: row.id, properties: { ...properties, searchGroups: groups } });
		}
		if (apply && (updates.length || hasColumn)) {
			const backup = path.join(os.tmpdir(), `hadithdb-book-groups-properties-${Date.now()}.json`);
			fs.writeFileSync(backup, JSON.stringify(rows, null, 2), { mode: 0o600 });
			console.log(`Backup: ${backup}`);
			for (const row of updates) await query('UPDATE books SET properties=?, content_lastmod=CURRENT_TIMESTAMP() WHERE id=?', [JSON.stringify(row.properties), row.id]);
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
