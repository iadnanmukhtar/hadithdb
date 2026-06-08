#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const MySQL = require('mysql');

const options = readOptions(process.argv.slice(2));

(async () => {
	try {
		const rows = await getRows(options);
		const groups = findMergeGroups(rows);
		const affectedAliases = unique(groups.map(group => group.alias));
		const rowsRemoved = groups.reduce((total, group) => total + group.deleteIds.length, 0);

		console.log(`${options.dryRun ? 'Checking' : 'Compacting'} consecutive Arabic tafsir ranges.`);
		console.log(`Found ${groups.length} range(s) to merge, ${rowsRemoved} row(s) to remove, across ${affectedAliases.length} commentary book(s).`);

		for (const summary of summarizeGroups(groups))
			console.log(`${summary.alias}: ${summary.groups} range(s), ${summary.rowsRemoved} row(s) removed`);

		if (options.showRanges) {
			for (const group of groups)
				console.log(`${group.alias} ${group.surah}:${group.ayahFrom}-${group.ayahTo} keep=${group.keepId} delete=${group.deleteIds.join(',')}`);
		}

		if (options.dryRun || groups.length < 1)
			return;

		await global.query('START TRANSACTION');
		try {
			const backupTable = await createBackup(groups);
			await mergeGroups(groups);
			await normalizePassageNumbers(affectedAliases);
			await global.query('COMMIT');
			console.log(`Backup table: ${backupTable}`);
			console.log(`Compacted ${groups.length} range(s) and removed ${rowsRemoved} row(s).`);
			console.log(`Reindex affected aliases with: ${affectedAliases.map(alias => `node bin/buildCommentariesIndex.js --tafsir ${alias}`).join(' && ')}`);
		} catch (err) {
			await global.query('ROLLBACK');
			throw err;
		}
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

async function getRows(options) {
	const where = [
		"bc.source='local'",
		'bc.hidden=0',
		"hc.text IS NOT NULL",
		"hc.text <> ''"
	];
	if (options.aliases.length > 0)
		where.push(`bc.alias IN (${options.aliases.map(MySQL.escape).join(',')})`);
	else
		where.push("bc.lang='ar'");
	return global.query(`
		SELECT
			hc.id,
			hc.bookCommentaryId,
			bc.alias,
			hc.hadithId,
			hc.surah,
			hc.ayahFrom,
			hc.ayahTo,
			hc.passageNum,
			hc.text
		FROM books_commentaries bc
		JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
		WHERE ${where.join('\n\t\t\tAND ')}
		ORDER BY bc.id, hc.surah, hc.ayahFrom, hc.ayahTo, hc.id`);
}

function findMergeGroups(rows) {
	const groups = [];
	let group = null;

	for (const row of rows) {
		if (!group || !isConsecutiveMatch(group, row)) {
			if (group && group.deleteIds.length > 0)
				groups.push(group);
			group = {
				bookCommentaryId: row.bookCommentaryId,
				alias: row.alias,
				surah: row.surah,
				ayahFrom: row.ayahFrom,
				ayahTo: row.ayahTo,
				keepId: row.id,
				hadithId: row.hadithId,
				text: row.text,
				deleteIds: []
			};
			continue;
		}

		group.ayahTo = row.ayahTo;
		group.deleteIds.push(row.id);
	}

	if (group && group.deleteIds.length > 0)
		groups.push(group);
	return groups;
}

function isConsecutiveMatch(group, row) {
	return row.bookCommentaryId === group.bookCommentaryId &&
		row.surah === group.surah &&
		row.ayahFrom === group.ayahTo + 1 &&
		row.text === group.text;
}

async function createBackup(groups) {
	const table = `hadiths_commentary_backup_compact_${timestamp()}`;
	const ids = unique(groups.flatMap(group => [group.keepId].concat(group.deleteIds)));
	await global.query(`CREATE TABLE ${table} LIKE hadiths_commentary`);
	for (let offset = 0; offset < ids.length; offset += 1000) {
		const batch = ids.slice(offset, offset + 1000);
		await global.query(`
			INSERT INTO ${table}
			SELECT *
			FROM hadiths_commentary
			WHERE id IN (${batch.join(',')})`);
	}
	return table;
}

async function mergeGroups(groups) {
	for (let offset = 0; offset < groups.length; offset += 500)
		await updateGroupBatch(groups.slice(offset, offset + 500));

	const deleteIds = groups.flatMap(group => group.deleteIds);
	for (let offset = 0; offset < deleteIds.length; offset += 1000) {
		const batch = deleteIds.slice(offset, offset + 1000);
		await global.query(`
			DELETE FROM hadiths_commentary
			WHERE id IN (${batch.join(',')})`);
	}
}

async function updateGroupBatch(groups) {
	const ids = groups.map(group => group.keepId);
	await global.query(`
		UPDATE hadiths_commentary
		SET
			ayahTo=CASE id
				${groups.map(group => `WHEN ${group.keepId} THEN ${group.ayahTo}`).join('\n\t\t\t\t')}
			END,
			passageNum=ayahFrom
		WHERE id IN (${ids.join(',')})`);
}

async function normalizePassageNumbers(aliases) {
	for (const alias of aliases) {
		await global.query(`
			UPDATE hadiths_commentary hc
			JOIN books_commentaries bc ON bc.id=hc.bookCommentaryId
			SET hc.passageNum=hc.ayahFrom
			WHERE bc.alias=${MySQL.escape(alias)}`);
	}
}

function summarizeGroups(groups) {
	const byAlias = new Map();
	for (const group of groups) {
		const current = byAlias.get(group.alias) || { alias: group.alias, groups: 0, rowsRemoved: 0 };
		current.groups++;
		current.rowsRemoved += group.deleteIds.length;
		byAlias.set(group.alias, current);
	}
	return Array.from(byAlias.values()).sort((a, b) => a.alias.localeCompare(b.alias));
}

function unique(values) {
	return Array.from(new Set(values));
}

function timestamp() {
	const now = new Date();
	return [
		now.getFullYear(),
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		pad(now.getHours()),
		pad(now.getMinutes()),
		pad(now.getSeconds()),
		String(now.getMilliseconds()).padStart(3, '0')
	].join('');
}

function pad(value) {
	return String(value).padStart(2, '0');
}

function readOptions(argv) {
	const options = {
		aliases: [],
		dryRun: true,
		showRanges: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--alias')
			options.aliases.push(requiredValue(argv, ++i, arg));
		else if (arg === '--apply')
			options.dryRun = false;
		else if (arg === '--dry-run')
			options.dryRun = true;
		else if (arg === '--show-ranges')
			options.showRanges = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return options;
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--'))
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function usage() {
	return [
		'Usage: node bin/utils/compact-arabic-tafsir-ranges.js [options]',
		'',
		'Combines consecutive local Arabic tafsir rows that have exact matching Arabic text.',
		'By default, it scans visible local books_commentaries rows with lang=ar.',
		'',
		'Options:',
		'  --alias <alias>     Limit to a commentary alias; can be repeated',
		'  --apply             Update MySQL; default is dry-run',
		'  --dry-run           Report only',
		'  --show-ranges       Print each merged range',
		'  --help              Show this help'
	].join('\n');
}
