#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const os = require('os');
const util = require('util');
const MySQL = require('mysql');

const BOOK_ID = 32;
const APPLY = process.argv.includes('--apply');

const categories = [
	{
		titleEn: 'Appearance',
		titleAr: 'مَظْهَرُ النَّبِيِّ ﷺ',
		chapters: [
			[1, 'Noble Features'],
			[2, 'Seal of Prophethood'],
			[3, 'Hair'],
			[4, 'Combing of Hair'],
			[5, 'White Hair'],
			[6, 'Hair Dye']
		]
	},
	{
		titleEn: 'Clothing & Accessories',
		titleAr: 'لِبَاسُ النَّبِيِّ ﷺ',
		chapters: [
			[7, 'Eyeliner'],
			[8, 'Clothing'],
			[8.02, 'Standard of Living'],
			[9, 'Socks'],
			[10, 'Shoes'],
			[11, 'Ring'],
			[12, 'Ring On His Right Hand'],
			[13, 'Sword'],
			[14, 'Armor'],
			[15, 'Helmet'],
			[16, 'Turban'],
			[17, 'Waistcloth']
		]
	},
	{
		titleEn: 'Posture',
		titleAr: 'وَضْعِيَّةُ النَّبِيِّ ﷺ',
		chapters: [
			[18, 'Walking'],
			[19, 'Headcovering'],
			[20, 'Sitting'],
			[21, 'Pillow'],
			[22, 'Leaning']
		]
	},
	{
		titleEn: 'Food and Drink',
		titleAr: 'طَعَامُ النَّبِيِّ ﷺ',
		chapters: [
			[23, 'Meals'],
			[24, 'Bread'],
			[25, 'Eating with Bread'],
			[26, 'Wudu at Time of Eating'],
			[27, 'Supplications of Eating'],
			[28, 'Beverage Cup'],
			[29, 'Eating of Fruits'],
			[30, 'Beverages'],
			[31, 'Manner of Drinking']
		]
	},
	{
		titleEn: 'Speech and Presence',
		titleAr: 'تَفَاعُلُ النَّبِيِّ ﷺ',
		chapters: [
			[32, 'Perfume'],
			[33, 'Speech'],
			[34, 'Laugh'],
			[35, 'Joking'],
			[36, 'About Poetry'],
			[37, 'Telling of Stories'],
			[38, 'Hadith of Umm Zara']
		]
	},
	{
		titleEn: 'Worship',
		titleAr: 'عُبُودِيَّةُ النَّبِيِّ ﷺ',
		chapters: [
			[39, 'Sleeping'],
			[40, 'Worship and Devotion'],
			[41, 'Mid-morning Prayers'],
			[42, 'Voluntary Prayers'],
			[43, 'Fasting'],
			[44, 'Recitation'],
			[45, 'Weeping']
		]
	},
	{
		titleEn: 'Character',
		titleAr: 'خُلُقُ النَّبِيِّ ﷺ',
		chapters: [
			[46, 'Bedding'],
			[47, 'Humility'],
			[48, 'Noble Character'],
			[49, 'Modesty'],
			[50, 'Cupping']
		]
	},
	{
		titleEn: 'Legacy',
		titleAr: 'حَيَاةُ النَّبِيِّ ﷺ وَوَفَاتُهُ',
		chapters: [
			[51, 'Names'],
			[52, 'Lifestyle'],
			[53, 'Age'],
			[54, 'Death'],
			[55, 'Legacy']
		]
	},
	{
		titleEn: 'Dreaming About the Prophet ﷺ',
		titleAr: 'رُؤْيَةُ النَّبِيِّ ﷺ',
		chapters: [
			[56, 'Dreaming About Prophet ﷺ']
		]
	}
];

const settings = require(os.homedir() + '/.hadithdb/settings.json');
const connection = MySQL.createConnection(settings.mysql.connection);
const query = util.promisify(connection.query).bind(connection);

(async function () {
	try {
		await query('START TRANSACTION');
		const current = await loadCurrentToc();
		validateCurrentToc(current);
		const plan = buildPlan(current);
		await applyPlan(plan);
		const validation = await validateResult();

		if (APPLY) {
			await query('COMMIT');
			console.log('Committed Shamail TOC reorganization.');
		} else {
			await query('ROLLBACK');
			console.log('Dry run complete; rolled back all changes.');
		}
		console.log(JSON.stringify(validation, null, 2));
	} catch (err) {
		try { await query('ROLLBACK'); } catch (rollbackErr) { /* preserve original error */ }
		console.error(err.stack || err.message);
		process.exitCode = 1;
	} finally {
		connection.end();
	}
})();

async function loadCurrentToc() {
	return query(`
		SELECT
			chapter.id AS chapterId,
			chapter.h1 AS oldH1,
			chapter.title_en AS chapterTitleEn,
			chapter.title AS chapterTitle,
			chapter.intro_en AS chapterIntroEn,
			chapter.intro AS chapterIntro,
			chapter.start,
			chapter.end,
			chapter.start0,
			chapter.end0,
			chapter.count,
			section.id AS sectionId,
			COUNT(h.id) AS linkedHadiths
		FROM toc chapter
		JOIN toc section
			ON section.bookId=chapter.bookId
			AND section.level=2
			AND section.h1=chapter.h1
			AND section.h2=1
		LEFT JOIN hadiths h ON h.tocId=section.id
		WHERE chapter.bookId=${BOOK_ID} AND chapter.level=1
		GROUP BY
			chapter.id, chapter.h1, chapter.title_en, chapter.title,
			chapter.intro_en, chapter.intro, chapter.start, chapter.end,
			chapter.start0, chapter.end0, chapter.count, section.id
		ORDER BY chapter.ordinal
		FOR UPDATE
	`);
}

function validateCurrentToc(current) {
	const expectedOldH1 = categories.flatMap(category => category.chapters.map(chapter => Number(chapter[0])));
	if (expectedOldH1.length !== 57 || new Set(expectedOldH1.map(key)).size !== 57)
		throw new Error('The sheet mapping must contain exactly 57 unique source chapters.');
	if (current.length !== 57)
		throw new Error(`Expected 57 current Shamail chapters, found ${current.length}.`);

	const currentByH1 = new Map(current.map(row => [key(row.oldH1), row]));
	for (const oldH1 of expectedOldH1) {
		if (!currentByH1.has(key(oldH1)))
			throw new Error(`Missing current Shamail chapter ${oldH1}.`);
	}
	for (const row of current) {
		if (!expectedOldH1.some(oldH1 => key(oldH1) === key(row.oldH1)))
			throw new Error(`Unmapped current Shamail chapter ${row.oldH1}.`);
		if (Number(row.count) !== Number(row.linkedHadiths))
			throw new Error(`Chapter ${row.oldH1} count mismatch: TOC=${row.count}, hadiths=${row.linkedHadiths}.`);
	}
}

function buildPlan(current) {
	const currentByH1 = new Map(current.map(row => [key(row.oldH1), row]));
	const plan = [];
	let ordinal = 1;
	for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex++) {
		const category = categories[categoryIndex];
		const plannedCategory = {
			h1: categoryIndex + 1,
			ordinal: ordinal++,
			titleEn: category.titleEn,
			titleAr: category.titleAr,
			chapters: []
		};
		for (let chapterIndex = 0; chapterIndex < category.chapters.length; chapterIndex++) {
			const source = currentByH1.get(key(category.chapters[chapterIndex][0]));
			plannedCategory.chapters.push({
				...source,
				h1: plannedCategory.h1,
				h2: chapterIndex + 1,
				ordinal: ordinal++,
				titleEn: category.chapters[chapterIndex][1]
			});
		}
		plan.push(plannedCategory);
	}
	return plan;
}

async function applyPlan(plan) {
	for (const category of plan) {
		for (const chapter of category.chapters) {
			await query(`
				UPDATE toc SET
					ordinal=${chapter.ordinal},
					level=2,
					h1=${category.h1},
					h2=${chapter.h2},
					h3=NULL,
					title_en=${MySQL.escape(chapter.titleEn)},
					title=${MySQL.escape(chapter.chapterTitle)},
					intro_en=${MySQL.escape(chapter.chapterIntroEn)},
					intro=${MySQL.escape(chapter.chapterIntro)},
					start=${MySQL.escape(chapter.start)},
					end=${MySQL.escape(chapter.end)},
					start0=${MySQL.escape(chapter.start0)},
					end0=${MySQL.escape(chapter.end0)},
					count=${Number(chapter.count)},
					lastmod_user='codex',
					lastfixed=CURRENT_TIMESTAMP()
				WHERE id=${Number(chapter.sectionId)} AND bookId=${BOOK_ID}
			`);
			await query(`
				UPDATE hadiths SET
					h1=${category.h1},
					h2=${chapter.h2},
					h3=NULL,
					lastmod_user='codex',
					lastfixed=CURRENT_TIMESTAMP()
				WHERE bookId=${BOOK_ID} AND tocId=${Number(chapter.sectionId)}
			`);
		}
	}

	const obsoleteChapterIds = plan.flatMap(category => category.chapters.map(chapter => Number(chapter.chapterId)));
	await query(`DELETE FROM toc WHERE bookId=${BOOK_ID} AND id IN (${obsoleteChapterIds.join(',')})`);

	for (const category of plan) {
		const first = category.chapters[0];
		const last = category.chapters[category.chapters.length - 1];
		const count = category.chapters.reduce((sum, chapter) => sum + Number(chapter.count), 0);
		await query(`
			INSERT INTO toc
				(ordinal, bookId, level, h1, h2, h3, title_en, title,
				 intro_en, intro, start, end, start0, end0, count, lastmod_user, lastfixed)
			VALUES
				(${category.ordinal}, ${BOOK_ID}, 1, ${category.h1}, NULL, NULL,
				 ${MySQL.escape(category.titleEn)}, ${MySQL.escape(category.titleAr)},
				 NULL, NULL, ${MySQL.escape(first.start)}, ${MySQL.escape(last.end)},
				 ${MySQL.escape(first.start0)}, ${MySQL.escape(last.end0)}, ${count},
				 'codex', CURRENT_TIMESTAMP())
		`);
	}
}

async function validateResult() {
	const tocSummary = (await query(`
		SELECT
			COUNT(*) AS headings,
			SUM(level=1) AS chapters,
			SUM(level=2) AS sections,
			COUNT(DISTINCT ordinal) AS distinctOrdinals,
			MIN(ordinal) AS minOrdinal,
			MAX(ordinal) AS maxOrdinal,
			SUM(CASE WHEN level=1 THEN count ELSE 0 END) AS chapterHadithCount,
			SUM(CASE WHEN level=2 THEN count ELSE 0 END) AS sectionHadithCount
		FROM toc
		WHERE bookId=${BOOK_ID}
	`))[0];
	const hadithSummary = (await query(`
		SELECT
			COUNT(*) AS hadiths,
			COUNT(DISTINCT tocId) AS linkedSections,
			SUM(section.id IS NULL) AS missingSection,
			SUM(section.h1<>h.h1 OR section.h2<>h.h2 OR section.h3 IS NOT NULL OR h.h3 IS NOT NULL) AS mismatchedHeading
		FROM hadiths h
		LEFT JOIN toc section ON section.id=h.tocId AND section.bookId=h.bookId AND section.level=2
		WHERE h.bookId=${BOOK_ID}
	`))[0];
	const countMismatches = (await query(`
		SELECT COUNT(*) AS mismatches FROM (
			SELECT section.id
			FROM toc section
			LEFT JOIN hadiths h ON h.tocId=section.id
			WHERE section.bookId=${BOOK_ID} AND section.level=2
			GROUP BY section.id, section.count
			HAVING section.count<>COUNT(h.id)
		) mismatched
	`))[0].mismatches;
	const categoryMismatches = (await query(`
		SELECT COUNT(*) AS mismatches FROM (
			SELECT chapter.id
			FROM toc chapter
			LEFT JOIN hadiths h ON h.bookId=chapter.bookId AND h.h1=chapter.h1
			WHERE chapter.bookId=${BOOK_ID} AND chapter.level=1
			GROUP BY chapter.id, chapter.count
			HAVING chapter.count<>COUNT(h.id)
		) mismatched
	`))[0].mismatches;

	const valid = Number(tocSummary.headings) === 66 &&
		Number(tocSummary.chapters) === 9 &&
		Number(tocSummary.sections) === 57 &&
		Number(tocSummary.distinctOrdinals) === 66 &&
		Number(tocSummary.minOrdinal) === 1 &&
		Number(tocSummary.maxOrdinal) === 66 &&
		Number(tocSummary.chapterHadithCount) === 402 &&
		Number(tocSummary.sectionHadithCount) === 402 &&
		Number(hadithSummary.hadiths) === 402 &&
		Number(hadithSummary.linkedSections) === 57 &&
		Number(hadithSummary.missingSection) === 0 &&
		Number(hadithSummary.mismatchedHeading) === 0 &&
		Number(countMismatches) === 0 &&
		Number(categoryMismatches) === 0;
	if (!valid)
		throw new Error(`Post-migration validation failed: ${JSON.stringify({ tocSummary, hadithSummary, countMismatches, categoryMismatches })}`);

	return { tocSummary, hadithSummary, countMismatches, categoryMismatches };
}

function key(value) {
	return Number(value).toFixed(2);
}
