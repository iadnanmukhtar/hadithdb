'use strict';

const Utils = require('./Utils');
const Tafsir = require('./Tafsir');
const QuranMushaf = require('./QuranMushaf');
const subdivisions = require('./QuranTocSubdivisions');

async function build() {
	const rows = await global.query("SELECT * FROM v_toc WHERE book_alias='quran' AND level IN (1,2,3) ORDER BY h1,h2,h3,ordinal");
	const chapters = {};
	for (const row of rows) {
		const n = row.level;
		const heading = { id: row['h' + n + '_id'] || row.id, level: n, h1: row.h1, h2: row.h2, h3: row.h3,
			title_en: row['h' + n + '_title_en'], title: row['h' + n + '_title'], path: row.path,
			intro: row['h' + n + '_intro'], intro_en: row['h' + n + '_intro_en'],
			start: row['h' + n + '_start'], count: row['h' + n + '_count'] };
		if (n === 1) chapters[row.h1] = { ...heading, sections: [] };
		else if (n === 2) chapters[row.h1].sections.push({ ...heading, subsections: [] });
		else chapters[row.h1].sections.find(h => h.h2 === row.h2)?.subsections.push(heading);
	}
	const juz = await Promise.all((await subdivisions.juzRows()).map(async row => {
		const [s, a] = row.start.split(':').map(Number);
		return { num: row.num, start: row.visual_start || row.start, title: row.title, startPage: await QuranMushaf.pageForRef(s, a) };
	}));
	const translations = Tafsir.visibleTranslationsSync().map(b => ({
		alias: b.alias, slug: b.quranBookSlug || b.alias, type: b.type, source: b.source, lang: b.lang,
		shortName_en: b.shortName_en, name_en: b.name_en, shortName: b.shortName, title: b.title,
		author: b.author, author_en: b.author_en, surname: Utils.englishAuthorSurname(b)
	}));
	return { chapters, surahs: global.surahs.map(({ num, name_en, name_ar, ayahs, revelation_en }) =>
		({ num, name_en, name_ar, ayahs, revelation_en })), juz, translations };
}
async function relationships() {
	const similar = {}, phrases = {}, byVerse = {};
	const rows = await global.query(`SELECT src.num AS ref, dest.num AS target, s.matched_words_count AS similar_matched_words_count,
		s.coverage AS similar_coverage, s.similarity_score AS similar_score FROM hadiths_sim s
		JOIN hadiths src ON src.id=s.hadithId1 JOIN hadiths dest ON dest.id=s.hadithId2
		WHERE s.similarity_source='qul_similar_ayah' ORDER BY src.id,s.similarity_ordinal`);
	for (const {ref, ...match} of rows) (similar[ref] ||= []).push(match);
	const occurrences = await global.query(`SELECT p.id,p.surah_count,p.ayah_count,p.occurrence_count,
		h.num AS ref,o.ayah_phrase_ordinal,o.word_from,o.word_to FROM quran_mutashabihat_occurrences o
		JOIN quran_mutashabihat_phrases p ON p.id=o.phrase_id JOIN hadiths h ON h.id=o.hadith_id
		ORDER BY h.id,o.ayah_phrase_ordinal,p.id,o.occurrence_ordinal`);
	for (const row of occurrences) {
		const phrase = phrases[row.id] ||= { id: row.id, ayahCount: row.ayah_count, surahCount: row.surah_count,
			occurrenceCount: row.occurrence_count, ranges: {} };
		if (!phrase.ranges[row.ref]) (byVerse[row.ref] ||= []).push(row.id);
		(phrase.ranges[row.ref] ||= []).push([row.word_from,row.word_to]);
	}
	return {similar, phrases, byVerse};
}
async function introductions(book) {
	const headings = require('./CommentaryHeadings');
	const [chapters, articles] = await Promise.all([headings.surahIntroductions(book.id), headings.introductionArticles(book.id)]);
	return { chapters, articles };
}
module.exports = { build, relationships, introductions };
