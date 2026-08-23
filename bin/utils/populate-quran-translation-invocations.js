#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');

const INVOCATIONS = Object.freeze({
	'en-khattab': Object.freeze({
		source: 'When you recite the Quran, seek refuge with Allah from Satan, the accursed.',
		text: 'I seek refuge with Allah from Satan, the accursed.'
	}),
	'en-saheeh-intl': Object.freeze({
		source: 'So when you recite the Qur’ān, [first] seek refuge in Allāh from Satan, the expelled [from His mercy].',
		text: 'I seek refuge in Allāh from Satan, the expelled [from His mercy].'
	}),
	'en-hilali-khan': Object.freeze({
		source: 'So when you want to recite the Qur’ân, seek refuge with Allâh from Shaitân (Satan), the outcast (the cursed one).',
		text: 'I seek refuge with Allâh from Shaitân (Satan), the outcast (the cursed one).'
	}),
	'en-bridges': Object.freeze({
		source: 'So when you<sup>sg</sup> recite the Recital[^1] seek refuge with Allah from Satan, the outcast.',
		text: 'I seek refuge with Allah from Satan, the outcast.'
	}),
	'en-taqi-usmani': Object.freeze({
		source: 'So, when you recite the Qur’ān, seek refuge with Allah against Satan, the accursed.',
		text: 'I seek refuge with Allah against Satan, the accursed.'
	}),
	'en-itani': Object.freeze({
		source: 'When you read the Quran, seek refuge with God from Satan the outcast.',
		text: 'I seek refuge with God from Satan the outcast.'
	}),
	'en-bewley': Object.freeze({
		source: "Whenever you recite the Qur'an, seek refuge with Allah from the accursed Shaytan.",
		text: 'I seek refuge with Allah from the accursed Shaytan.'
	}),
	'en-study-quran': Object.freeze({
		source: 'So when you recite the Quran, seek refuge in God from the outcast Satan',
		text: 'I seek refuge in God from the outcast Satan.'
	}),
	'en-ghali': Object.freeze({
		source: "So when you read the Qur'an, then seek refuge in Allah from the outcast Shaytan (The all-vicious, i.e., the Devil).",
		text: 'I seek refuge in Allah from the outcast Shaytan (the all-vicious, i.e., the Devil).'
	}),
	'en-ahmedraza': Object.freeze({
		source: 'And when you recite the Qur’an, seek the refuge of Allah from Satan the outcast.',
		text: 'I seek the refuge of Allah from Satan the outcast.'
	}),
	'en-wahiduddin': Object.freeze({
		source: "When you read the Quran, seek God's protection from Satan, the rejected one.",
		text: "I seek God's protection from Satan, the rejected one."
	}),
	'en-qaribullah': Object.freeze({
		source: 'When you recite the Koran, seek refuge in Allah from the stoned satan:',
		text: 'I seek refuge in Allah from the stoned satan.'
	}),
	'en-busool': Object.freeze({
		source: 'And when you read the Quran, seek refuge with God from the stoned devil.',
		text: 'I seek refuge with God from the stoned devil.'
	}),
	'en-tahir-ul-qadri': Object.freeze({
		source: 'So when you undertake to recite the Qur’an, seek refuge with Allah against (the wiles of) Satan, the outcast',
		text: 'I seek refuge with Allah against (the wiles of) Satan, the outcast.'
	}),
	'en-rowwad': Object.freeze({
		source: 'When you recite the Qur’an, seek refuge with Allah from the accursed Satan.',
		text: 'I seek refuge with Allah from the accursed Satan.'
	}),
	'en-asad': Object.freeze({
		source: "NOW whenever thou happen to read this Qur'an, seek refuge with God from Satan, the accursed.",
		text: 'I seek refuge with God from Satan, the accursed.'
	}),
	'en-sarwar': Object.freeze({
		source: '(Muhammad), when you recite the Quran, seek refuge in God from the mischief of satan.',
		text: 'I seek refuge in God from the mischief of satan.'
	}),
	'en-daryabadi': Object.freeze({
		source: "And when thou wouldst read the Qur'an seek refuge with Allah from Satan the damned.",
		text: 'I seek refuge with Allah from Satan the damned.'
	}),
	'en-shakir': Object.freeze({
		source: 'So when you recite the Quran, seek refuge with Allah from the accursed Shaitan,',
		text: 'I seek refuge with Allah from the accursed Shaitan.'
	}),
	'en-pickthall': Object.freeze({
		source: "And when thou recitest the Qur'an, seek refuge in Allah from Satan the outcast.",
		text: 'I seek refuge in Allah from Satan the outcast.'
	}),
	'en-qarai': Object.freeze({
		source: 'When you recite the Quran, seek the protection of Allah against the outcast Satan.',
		text: 'I seek the protection of Allah against the outcast Satan.'
	})
});

async function main(argv) {
	const apply = readOptions(argv).apply;
	require('dotenv').config();
	require('../../lib/Globals');
	const QuranTocSubdivisions = require('../../lib/QuranTocSubdivisions');
	try {
		await QuranTocSubdivisions.preload();
		const plan = await buildPlan();
		printPlan(plan, apply);
		if (apply)
			await applyPlan(plan);
	} finally {
		await endPool();
	}
}

function readOptions(argv) {
	const options = { apply: false };
	(argv || []).forEach(function (arg) {
		if (arg === '--apply')
			options.apply = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	});
	return options;
}

function usage() {
	return [
		'Usage: node bin/utils/populate-quran-translation-invocations.js [--apply]',
		'',
		'Creates Quran 1:0 for every visible local English translation using that',
		"translation's wording of Quran 16:98. Dry-run is the default.",
		'',
		'Options:',
		'  --apply  Apply the inserts or updates transactionally',
		'  --help   Show this help'
	].join('\n');
}

async function buildPlan() {
	const books = await global.query(`
		SELECT id, alias, shortName_en
		FROM books
		WHERE type='trans' AND source='local' AND hidden=0
		ORDER BY ordinal, id`);
	validateCatalog(books);
	const rows = await global.query(`
		SELECT b.id AS bookId, b.alias, hc.id, hc.surah, hc.ayahFrom, hc.ayahTo, hc.text_en, hc.footnotes_en
		FROM books b
		JOIN hadiths_commentary hc ON hc.bookId=b.id
		WHERE b.type='trans' AND b.source='local' AND b.hidden=0
			AND ((hc.surah=16 AND hc.ayahFrom<=98 AND hc.ayahTo>=98)
				OR (hc.surah=1 AND hc.ayahFrom=0 AND hc.ayahTo=0))
		ORDER BY b.ordinal, b.id, hc.surah, hc.ayahFrom, hc.ayahTo`);
	const invocationHadith = (await global.query(`
		SELECT h.id
		FROM hadiths h
		JOIN books b ON b.id=h.bookId
		WHERE b.alias='quran' AND h.h1=1 AND h.numInChapter=0
		LIMIT 2`));
	if (invocationHadith.length !== 1)
		throw new Error(`Expected one Quran 1:0 row, found ${invocationHadith.length}.`);
	return planRows(books, rows, Number(invocationHadith[0].id));
}

function validateCatalog(books) {
	const aliases = (books || []).map(book => book.alias).sort();
	const configured = Object.keys(INVOCATIONS).sort();
	const missing = aliases.filter(alias => !Object.prototype.hasOwnProperty.call(INVOCATIONS, alias));
	const stale = configured.filter(alias => !aliases.includes(alias));
	if (missing.length || stale.length)
		throw new Error(`Invocation catalog mismatch; missing=${missing.join(',') || 'none'} stale=${stale.join(',') || 'none'}.`);
}

function planRows(books, rows, hadithId) {
	return books.map(function (book) {
		const sourceRows = rows.filter(row => row.alias === book.alias && Number(row.surah) === 16);
		const existingRows = rows.filter(row => row.alias === book.alias && Number(row.surah) === 1);
		if (sourceRows.length !== 1)
			throw new Error(`Expected one ${book.alias} row covering Quran 16:98, found ${sourceRows.length}.`);
		if (existingRows.length > 1)
			throw new Error(`Expected at most one ${book.alias} Quran 1:0 row, found ${existingRows.length}.`);
		const configured = INVOCATIONS[book.alias];
		if ((sourceRows[0].text_en || '') !== configured.source)
			throw new Error(`${book.alias} Quran 16:98 has changed; review its Quran 1:0 wording before applying.`);
		const existing = existingRows[0] || null;
		const unchanged = !!existing
			&& (existing.text_en || '') === configured.text
			&& !existing.footnotes_en;
		return {
			bookId: Number(book.id),
			alias: book.alias,
			shortName: book.shortName_en || book.alias,
			hadithId: hadithId,
			text: configured.text,
			action: unchanged ? 'unchanged' : (existing ? 'update' : 'create')
		};
	});
}

function printPlan(plan, apply) {
	plan.forEach(row => console.log(`${row.action.padEnd(9)} ${row.alias}: ${row.text}`));
	const changed = plan.filter(row => row.action !== 'unchanged').length;
	console.log(`${apply ? 'Applying' : 'Would apply'} ${changed} Quran 1:0 translation row(s); ${plan.length - changed} unchanged.`);
}

async function applyPlan(plan) {
	const changed = plan.filter(row => row.action !== 'unchanged');
	if (changed.length < 1)
		return;
	const connection = await getConnection();
	try {
		await query(connection, 'START TRANSACTION');
		for (const row of changed) {
			await query(connection, `
				INSERT INTO hadiths_commentary
					(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text_en, footnotes_en)
				VALUES
					(${row.bookId}, ${row.hadithId}, 1, 0, 0, 0, ${MySQL.escape(row.text)}, NULL)
				ON DUPLICATE KEY UPDATE
					hadithId=VALUES(hadithId),
					passageNum=VALUES(passageNum),
					text_en=VALUES(text_en),
					footnotes_en=NULL,
					lastmod=CURRENT_TIMESTAMP()`);
		}
		await query(connection, `
			UPDATE books
			SET content_lastmod=CURRENT_TIMESTAMP()
			WHERE id IN (${changed.map(row => row.bookId).join(',')})`);
		await query(connection, 'COMMIT');
	} catch (err) {
		await query(connection, 'ROLLBACK');
		throw err;
	} finally {
		connection.release();
	}
}

function getConnection() {
	return new Promise((resolve, reject) => {
		global.dbPool.getConnection((err, connection) => err ? reject(err) : resolve(connection));
	});
}

function query(connection, sql) {
	return new Promise((resolve, reject) => {
		connection.query(sql, (err, result) => err ? reject(err) : resolve(result));
	});
}

function endPool() {
	return new Promise(resolve => {
		if (!global.dbPool || typeof global.dbPool.end !== 'function')
			return resolve();
		global.dbPool.end(function () { resolve(); });
	});
}

if (require.main === module) {
	main(process.argv.slice(2)).catch(function (err) {
		console.error(err.stack || err.message);
		process.exitCode = 1;
	});
}

module.exports = {
	INVOCATIONS,
	planRows,
	validateCatalog
};
