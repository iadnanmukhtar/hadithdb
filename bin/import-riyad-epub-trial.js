#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('fs');
const mysql = require('mysql');
const path = require('path');
const util = require('util');
const { connectionSettings } = require('./initializeHadithAttributions');

const BOOK_ALIAS = 'riyad';
const EPUB = path.resolve(__dirname, '../temp/ رياض الصالحين.epub');
const APPLY = process.argv.includes('--apply');
const USER = 'epub:riyad-trial';

// The printed references in this edition do not always use the same numbering
// scheme as the local six-books corpus. localNum identifies the exact local
// hadith whose text corresponds to the cited report.
const CHAPTERS = [
	{
		h1: 0.34,
		headingFile: 326,
		intro: 'قَالَ الله تَعَالَى: ﴿وَعَاشِرُوهُنَّ بِالْمَعْرُوف﴾ [النساء: ١٩]، وَقالَ تَعَالَى: ﴿وَلَنْ تَسْتَطِيعُوا أَنْ تَعْدِلُوا بَيْنَ النِّسَاءِ وَلَوْ حَرَصْتُمْ فَلا تَمِيلُوا كُلَّ الْمَيْلِ فَتَذَرُوهَا كَالْمُعَلَّقَةِ وَإِنْ تُصْلِحُوا وَتَتَّقُوا فَإِنَّ اللهَ كَانَ غَفُورًا رَحِيمًا﴾ [النساء: ١٢٩].',
		hadiths: [
			{ num: 273, file: 327, primary: 'bukhari:3331', refs: ['bukhari:3331', 'muslim:1468a'], noteStartsWith: 'وفي رواية في الصحيحين:' },
			{ num: 274, file: 328, primary: 'bukhari:4942', refs: ['bukhari:4942', 'muslim:2855'], noteStartsWith: '«وَالعَارِمُ»' },
			{ num: 275, file: 329, primary: 'muslim:1468b', refs: ['muslim:1468b'], noteStartsWith: 'وقولُهُ: «يَفْرَكْ»' },
			{ num: 276, file: 330, primary: 'tirmidhi:1163', refs: ['ibnmajah:1851', 'tirmidhi:1163', 'nasai-kubra:9124'], noteStartsWith: 'قوله ﷺ: «عَوان»' },
			{ num: 277, file: 331, primary: 'abudawud:2142', refs: ['abudawud:2142', 'ibnmajah:1850', 'nasai-kubra:9126'], noteStartsWith: 'وَقالَ: معنى «لا تُقَبِّحْ»' },
			{ num: 278, file: 332, primary: 'tirmidhi:1162', refs: ['abudawud:4682', 'tirmidhi:1162'] },
			{ num: 279, file: 333, primary: 'abudawud:2146', refs: ['abudawud:2146', 'ibnmajah:1985', 'nasai-kubra:9122'], noteStartsWith: 'قوله: «ذَئِرنَ»' },
			{ num: 280, file: 334, primary: 'muslim:715k', refs: ['muslim:715k'] }
		]
	},
	{
		h1: 0.35,
		headingFile: 335,
		intro: 'قَالَ الله تَعَالَى: ﴿الرِّجَالُ قَوَّامُونَ عَلَى النِّسَاءِ بِمَا فَضَّلَ اللهُ بَعْضَهُمْ عَلَى بَعْضٍ وَبِمَا أَنْفَقُوا مِنْ أَمْوَالِهِمْ فَالصَّالِحَاتُ قَانِتَاتٌ حَافِظَاتٌ لِلْغَيْبِ بِمَا حَفِظَ الله﴾ [النساء: ٣٤].\n\nوأما الأحاديث فمنها حديث عمرو بن الأحوص السابق في الباب قبله.',
		hadiths: [
			{ num: 281, file: 336, primary: 'bukhari:5193', refs: ['bukhari:5193', 'muslim:1436d'], noteStartsWith: 'وفي رواية لهما:' },
			{ num: 282, file: 337, primary: 'bukhari:5195', refs: ['bukhari:5195', 'muslim:1026'], noteStartsWith: 'وهذا لفظ البخاري.' },
			{ num: 283, file: 338, primary: 'bukhari:5200', refs: ['bukhari:5200', 'muslim:1829a'] },
			{ num: 284, file: 339, primary: 'tirmidhi:1160', refs: ['tirmidhi:1160', 'nasai-kubra:8922'] },
			{ num: 285, file: 340, primary: 'tirmidhi:1159', refs: ['tirmidhi:1159'] },
			{ num: 286, file: 341, primary: 'tirmidhi:1161', refs: ['ibnmajah:1854', 'tirmidhi:1161'] },
			{ num: 287, file: 342, primary: 'tirmidhi:1174', refs: ['ibnmajah:2014', 'tirmidhi:1174'] },
			{ num: 288, file: 343, primary: 'bukhari:5096', refs: ['bukhari:5096', 'muslim:2740'] }
		]
	}
];

function compactText(value) {
	return String(value || '')
		.replace(/\[ص:\s*\d+\]/gu, '')
		.replace(/\s+/gu, ' ')
		.replace(/\s+([،؛:.])/gu, '$1')
		.trim();
}

function cleanText(value) {
	return String(value || '')
		.replace(/\r/g, '')
		.replace(/\[ص:\s*\d+\]/gu, '')
		.split('\n')
		.map(line => compactText(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function normalizeBlessings(value) {
	return cleanText(value)
		.replace(/\s*-\s*صلى الله عليه وسلم\s*-?/gu, ' ﷺ')
		.replace(/\s+-\s+رضي الله عنهما?\s+-?/gu, match => compactText(match).replace(/^-\s*|\s*-$/g, ''));
}

function epubHadith(zip, fileNumber, expectedNumber) {
	const entry = zip.getEntry(`OEBPS/xhtml/P${fileNumber}.xhtml`);
	if (!entry)
		throw new Error(`Missing EPUB XHTML P${fileNumber}`);
	const $ = cheerio.load(entry.getData().toString('utf8'), { xmlMode: true, decodeEntities: true });
	const container = $('#book-container').clone();
	const marker = container.find('span.red').first();
	const printedNumber = compactText(marker.text()).replace(/\D/g, '');
	if (Number(printedNumber) !== expectedNumber)
		throw new Error(`P${fileNumber} contains hadith ${printedNumber}, expected ${expectedNumber}`);
	const contents = container.contents();
	const markerIndex = contents.toArray().findIndex(node => node === marker[0]);
	if (markerIndex < 0)
		throw new Error(`Could not locate hadith marker in P${fileNumber}`);
	contents.slice(0, markerIndex).remove();
	container.find('br').replaceWith('\n\n');
	container.find('.footnote-hr, .footnote, hr, span.title').remove();
	marker.remove();
	return normalizeBlessings(container.text());
}

function splitTextAndNote(text, noteStartsWith) {
	if (!noteStartsWith)
		return { textActual: text, note: null };
	const normalizedStart = normalizeBlessings(noteStartsWith);
	const index = text.indexOf(normalizedStart);
	if (index < 0)
		throw new Error(`Could not find note boundary: ${normalizedStart}`);
	return {
		textActual: cleanText(text.slice(0, index)),
		note: cleanText(text.slice(index))
	};
}

function numberedRefs(hadith) {
	if (hadith.refs.length === 1)
		return [{ ...parseRef(hadith.refs[0]), num: String(hadith.num), num0: hadith.num }];
	return hadith.refs.map((ref, index) => ({
		...parseRef(ref),
		num: `${hadith.num}${String.fromCharCode(97 + index)}`,
		num0: hadith.num + ((index + 1) / 1000)
	}));
}

function parseRef(ref) {
	const separator = ref.indexOf(':');
	return { ref, alias: ref.slice(0, separator), localNum: ref.slice(separator + 1) };
}

async function buildRows(query, zip, book) {
	const tocRows = await query('SELECT id, h1 FROM toc WHERE bookId=? AND level=1 AND h1 IN (0.34, 0.35)', [book.id]);
	const tocByH1 = new Map(tocRows.map(row => [Number(row.h1).toFixed(2), row.id]));
	if (tocByH1.size !== CHAPTERS.length)
		throw new Error(`Expected ${CHAPTERS.length} trial headings, found ${tocByH1.size}`);

	const rows = [];
	for (const chapter of CHAPTERS) {
		if (!zip.getEntry(`OEBPS/xhtml/P${chapter.headingFile}.xhtml`))
			throw new Error(`Missing EPUB chapter file P${chapter.headingFile}`);
		let numInChapter = 0;
		for (const hadith of chapter.hadiths) {
			const sourceText = epubHadith(zip, hadith.file, hadith.num);
			const content = splitTextAndNote(sourceText, hadith.noteStartsWith);
			for (const ref of numberedRefs(hadith)) {
				numInChapter++;
				const matches = await query(`SELECT h.id FROM hadiths h JOIN books b ON b.id=h.bookId
					WHERE b.alias=? AND h.num=? LIMIT 2`, [ref.alias, ref.localNum]);
				if (matches.length !== 1)
					throw new Error(`${ref.ref}: expected one local hadith, found ${matches.length}`);
				const isPrimary = ref.ref === hadith.primary;
				rows.push({
					bookId: book.id,
					tocId: tocByH1.get(chapter.h1.toFixed(2)),
					numInChapter,
					h1: chapter.h1,
					num: ref.num,
					num0: ref.num0,
					hadithId: matches[0].id,
					ref_num: ref.ref,
					textActual: isPrimary ? content.textActual : null,
					bookActual: isPrimary ? parseRef(hadith.primary).alias : null,
					muttafaq: isPrimary && /مُتَّفَقٌ عَلَيهِ/u.test(content.textActual) ? 1 : null,
					note: isPrimary ? content.note : null
				});
			}
		}
	}
	return rows;
}

async function main() {
	if (!fs.existsSync(EPUB))
		throw new Error(`EPUB not found: ${EPUB}`);
	const zip = new AdmZip(EPUB);
	const db = mysql.createConnection(connectionSettings());
	const query = util.promisify(db.query).bind(db);
	try {
		await util.promisify(db.connect).call(db);
		const books = await query('SELECT id, alias, `virtual` FROM books WHERE alias=? LIMIT 2', [BOOK_ALIAS]);
		if (books.length !== 1 || Number(books[0].virtual) !== 1)
			throw new Error(`Expected one virtual book with alias ${BOOK_ALIAS}`);
		const book = books[0];
		const rows = await buildRows(query, zip, book);
		const existing = await query('SELECT * FROM hadiths_virtual WHERE bookId=? AND h1 IN (0.34, 0.35) ORDER BY ordinal, id', [book.id]);
		console.log(`EPUB trial plan: replace ${existing.length} existing rows with ${rows.length} rows.`);
		for (const chapter of CHAPTERS) {
			const chapterRows = rows.filter(row => row.h1 === chapter.h1);
			console.log(`h1=${chapter.h1.toFixed(2)}: ${chapterRows.map(row => `${row.num}=${row.ref_num}`).join(', ')}`);
		}
		if (!APPLY) {
			console.log('Dry run only. Re-run with --apply to write the trial import.');
			return;
		}

		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backup = path.resolve(__dirname, `../temp/riyad-0.34-0.35-before-${stamp}.json`);
		fs.writeFileSync(backup, `${JSON.stringify(existing, null, 2)}\n`);
		await query('START TRANSACTION');
		try {
			const firstOrdinal = existing.length ? Math.min(...existing.map(row => Number(row.ordinal))) : 0;
			await query('DELETE FROM hadiths_virtual WHERE bookId=? AND h1 IN (0.34, 0.35)', [book.id]);
			for (let index = 0; index < rows.length; index++) {
				const row = rows[index];
				await query(`INSERT INTO hadiths_virtual
					(ordinal, bookId, tocId, numInChapter, h1, h2, h3, num, num0, hadithId,
					 ref_num, textActual, bookActual, muttafaq, note_en, note, lastmod, lastfixed, lastmod_user)
					VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), ?)`,
					[firstOrdinal + index, row.bookId, row.tocId, row.numInChapter, row.h1, row.num,
						row.num0, row.hadithId, row.ref_num, row.textActual, row.bookActual, row.muttafaq, row.note, USER]);
			}
			for (const chapter of CHAPTERS) {
				const count = rows.filter(row => row.h1 === chapter.h1).length;
				await query(`UPDATE toc SET intro=?, start=?, count=?, lastmod=CURRENT_TIMESTAMP(),
					lastfixed=CURRENT_TIMESTAMP(), lastmod_user=? WHERE bookId=? AND level=1 AND h1=?`,
					[chapter.intro, String(chapter.hadiths[0].num), count, USER, book.id, chapter.h1]);
			}
			const range = (await query('SELECT MIN(ordinal) AS firstOrdinal FROM hadiths_virtual WHERE bookId=?', [book.id]))[0];
			await query('SET @riyad_ordinal:=?', [Number(range.firstOrdinal) - 1]);
			await query(`UPDATE hadiths_virtual SET ordinal=(@riyad_ordinal:=@riyad_ordinal+1)
				WHERE bookId=? ORDER BY num0, ordinal, id`, [book.id]);
			await query('COMMIT');
		} catch (error) {
			await query('ROLLBACK');
			throw error;
		}
		await query('CALL refresh_v_hadiths_virtual_snapshot(?)', [book.id]);
		console.log(`Applied trial import. Backup: ${backup}`);
	} finally {
		db.end();
	}
}

main().catch(error => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
