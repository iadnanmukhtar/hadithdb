'use strict';

const MySQL = require('mysql');
const Utils = require('./Utils');

function number(value) {
	value = Number(value);
	return Number.isInteger(value) ? value : null;
}

async function book(bookId) {
	bookId = number(bookId);
	if (!bookId || bookId <= 0)
		return null;
	return (await global.query(`SELECT id, alias, type, source, hidden
		FROM books WHERE id=${bookId} AND type IN ('tafsir', 'trans') LIMIT 1`))[0] || null;
}

async function introductionBook(bookId) {
	bookId = number(bookId);
	if (!bookId || bookId <= 0)
		return null;
	return (await global.query(`SELECT id, alias, type, source, hidden
		FROM books WHERE id=${bookId} AND type IN ('hadith', 'tafsir', 'trans') LIMIT 1`))[0] || null;
}

async function chapter(bookId, surah) {
	bookId = number(bookId);
	surah = number(surah);
	if (!bookId || surah === null || surah < 0 || surah > 114)
		return null;
	return (await global.query(`SELECT * FROM toc
		WHERE bookId=${bookId} AND level=1 AND h1=${surah}
		ORDER BY id LIMIT 1`))[0] || null;
}

async function introductionArticles(bookId) {
	bookId = number(bookId);
	if (!bookId)
		return [];
	return global.query(`SELECT * FROM toc
		WHERE bookId=${bookId} AND level=2 AND h1=0
		ORDER BY h2, ordinal, id`);
}

async function surahIntroductions(bookId) {
	bookId = number(bookId);
	if (!bookId)
		return [];
	return global.query(`SELECT * FROM toc
		WHERE bookId=${bookId} AND level=1 AND h1 BETWEEN 1 AND 114
		ORDER BY h1, ordinal, id`);
}

function hasText(row) {
	return Boolean(Utils.trimToEmpty(row && row.intro_en) || Utils.trimToEmpty(row && row.intro));
}

function hasIntroduction(articles) {
	return (articles || []).some(hasText);
}

async function ensureChapter(bookId, surah, userId) {
	const commentaryBook = await book(bookId);
	surah = number(surah);
	if (!commentaryBook)
		throw new ReferenceError('Commentary book not found');
	if (surah === null || surah < 0 || surah > 114)
		throw new RangeError('Invalid commentary surah');
	let row = await chapter(commentaryBook.id, surah);
	if (row)
		return row;
	const surahMetadata = surah > 0
		? (global.surahs || []).find(item => Number(item.num) === surah)
		: null;
	const titleEn = surah === 0 ? 'Introduction' : (surahMetadata && surahMetadata.name_en) || `Surah ${surah}`;
	const titleAr = surah === 0 ? 'المقدمة' : (surahMetadata && surahMetadata.name_ar) || `السورة ${surah}`;
	const result = await global.query(`INSERT INTO toc
		(ordinal, bookId, level, h1, h2, h3, title_en, title, lastmod_user, lastfixed)
		VALUES (${surah * 1000}, ${commentaryBook.id}, 1, ${surah}, NULL, NULL,
			${MySQL.escape(titleEn)}, ${MySQL.escape(titleAr)}, ${MySQL.escape(userId || '')}, CURRENT_TIMESTAMP())`);
	return chapter(commentaryBook.id, surah) || { id: result.insertId, bookId: commentaryBook.id, level: 1, h1: surah, title_en: titleEn, title: titleAr };
}

async function addIntroductionArticle(bookId, value, userId) {
	const contentBook = await introductionBook(bookId);
	if (!contentBook)
		throw new ReferenceError('Book not found');
	let introductionChapter = await chapter(contentBook.id, 0);
	if (!introductionChapter) {
		if (contentBook.type === 'hadith') {
			const chapterResult = await global.query(`INSERT INTO toc
				(ordinal, bookId, level, h1, h2, h3, title_en, title, lastmod_user, lastfixed)
				VALUES (0, ${contentBook.id}, 1, 0, NULL, NULL,
					'Introduction', 'المقدمة', ${MySQL.escape(userId || '')}, CURRENT_TIMESTAMP())`);
			introductionChapter = { id: chapterResult.insertId };
		} else {
			introductionChapter = await ensureChapter(contentBook.id, 0, userId);
		}
	}
	const existing = await introductionArticles(contentBook.id);
	const h2 = Math.max(0, ...existing.map(row => Number(row.h2)).filter(Number.isInteger)) + 1;
	value = value && typeof value === 'object' ? value : {};
	const titleEn = Utils.trimToEmpty(value.title_en) || `Introduction ${h2}`;
	const titleAr = Utils.trimToEmpty(value.title) || '';
	const result = await global.query(`INSERT INTO toc
		(ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, lastmod_user, lastfixed)
		VALUES (${h2}, ${contentBook.id}, 2, 0, ${h2}, NULL,
			${MySQL.escape(titleEn)}, ${MySQL.escape(titleAr)}, '', '', ${MySQL.escape(userId || '')}, CURRENT_TIMESTAMP())`);
	return {
		message: result.message,
		value: { id: result.insertId, chapterId: introductionChapter.id, h1: 0, h2: h2, title_en: titleEn, title: titleAr }
	};
}

module.exports = {
	addIntroductionArticle,
	book,
	chapter,
	ensureChapter,
	hasIntroduction,
	hasText,
	introductionBook,
	introductionArticles,
	surahIntroductions
};
