'use strict';

const MySQL = require('mysql');
const QuranMushaf = require('./QuranMushaf');

const SCRIPTS = Object.freeze({
	'indo-pak': Object.freeze({ slug: 'indo-pak', name: 'Indo-Pak', fontFamily: 'QuranIndoPak' }),
	warsh: Object.freeze({ slug: 'warsh', name: 'Warsh', fontFamily: 'QuranWarsh' })
});
const BODY_COLUMNS = Object.freeze({ 'indo-pak': 'body_indopak', warsh: 'body_warsh' });

function normalizeSlug(value) {
	value = (value || '').toString().trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(SCRIPTS, value) ? value : '';
}

function normalizeRefs(value, maximum = 250) {
	const seen = new Set();
	return (Array.isArray(value) ? value : (value || '').toString().split(','))
		.map(ref => (ref || '').toString().trim().replace(/^quran:/, ''))
		.filter(ref => {
			const match = ref.match(/^(\d{1,3}):(\d{1,3})$/);
			const surah = match ? Number(match[1]) : 0;
			const ayah = match ? Number(match[2]) : 0;
			if (!match || surah < 1 || surah > 114 || ayah < 1 || ayah > 300 || seen.has(ref) || seen.size >= maximum)
				return false;
			seen.add(ref);
			return true;
		});
}

async function passage(slug, refs, surah) {
	slug = normalizeSlug(slug);
	refs = normalizeRefs(refs);
	const wholeSurah = Number.isInteger(surah) && surah >= 1 && surah <= 114;
	if (!slug || (!wholeSurah && refs.length < 1))
		return { script: SCRIPTS[slug] || null, ayahsByRef: {}, wordsByAyah: {} };
	const script = SCRIPTS[slug];
	const bodyColumn = BODY_COLUMNS[slug];
	const refsSql = refs.map(MySQL.escape).join(',');
	const slugSql = MySQL.escape(slug);
	const ayahFilter = wholeSurah ? `h.h1=${surah}` : `h.num IN (${refsSql})`;
	const wordFilter = wholeSurah ? `surah=${surah}` : `CONCAT(surah, ':', ayah) IN (${refsSql})`;
	const [ayahs, words] = await Promise.all([
		global.query(`
			SELECT h.num AS ref, h.${bodyColumn} AS text
			FROM hadiths h
			JOIN toc t ON h.tocId=t.id
			WHERE t.bookId=0 AND ${ayahFilter}
			ORDER BY h.ordinal`),
		global.query(`
			SELECT surah, ayah, word, text
			FROM quran_corpus_script_words
			WHERE script_slug=${slugSql} AND ${wordFilter}
			ORDER BY surah, ayah, word`)
	]);
	const ayahsByRef = {};
	const wordsByAyah = {};
	ayahs.forEach(row => { if (row.text) ayahsByRef[row.ref] = row.text; });
	words.forEach(row => {
		const ref = `${row.surah}:${row.ayah}`;
		if (!wordsByAyah[ref]) wordsByAyah[ref] = [];
		wordsByAyah[ref].push({ word: Number(row.word), text: row.text });
	});
	return { script: SCRIPTS[slug], ayahsByRef, wordsByAyah };
}

// Store the master text separately from the Mushaf tokens: the display form
// can include the basmalah while the study text preserves its own wording.
async function editionPart(slug, part) {
	const from = 1 + part * 4;
	const to = Math.min(114, from + 3);
	const uthmani = slug === 'uthmani';
	if ((!uthmani && !normalizeSlug(slug)) || !Number.isInteger(part) || part < 0 || from > 114)
		return null;
	const columns = uthmani ? 'body, body_ar_alt, body_en, footnote_en, chain, chain_en, id' : BODY_COLUMNS[slug] + ' AS body';
	const [verses, words, pages] = await Promise.all([
		global.query(`SELECT num AS ref, ${columns} FROM hadiths WHERE bookId=0 AND h1 BETWEEN ${from} AND ${to} ORDER BY ordinal`),
		uthmani ? global.query(`SELECT map.surah, map.ayah, map.word, COALESCE(map.source_text, corpus.text) AS text
			FROM quran_mushaf_words map LEFT JOIN quran_corpus_words corpus ON corpus.id=map.corpus_word_id
			WHERE map.is_ayah_marker=0 AND map.surah BETWEEN ${from} AND ${to} ORDER BY map.global_word_id`)
			: global.query(`SELECT surah, ayah, word, text FROM quran_corpus_script_words
				WHERE script_slug=${MySQL.escape(slug)} AND surah BETWEEN ${from} AND ${to} ORDER BY surah, ayah, word`),
		uthmani ? QuranMushaf.referenceMappings() : null
	]);
	const ayahsByRef = {}, wordsByAyah = {}, records = {};
	for (const verse of verses) {
		if (verse.body) ayahsByRef[verse.ref] = verse.body;
		if (uthmani) records[verse.ref] = { id: verse.id, page: pages.get(verse.ref)?.first, display: verse.body_ar_alt || verse.body,
			chain: verse.chain, chain_en: verse.chain_en, translation: verse.body_en || '', footnotes: verse.footnote_en || '' };
	}
	for (const { surah, ayah, word, text } of words) {
		const ref = surah + ':' + ayah;
		(wordsByAyah[ref] ||= []).push({ word, text });
	}
	const chapters = {};
	if (uthmani) {
		for (const chapter of global.surahs.filter(row => row.num >= from && row.num <= to)) {
			const previous = global.surahs.find(row => row.num === (chapter.num === 1 ? 114 : chapter.num - 1));
			chapters[chapter.num] = { title: chapter.name_en, count: chapter.ayahs, previousCount: previous.ayahs };
		}
	}
	return { ayahsByRef, wordsByAyah, ...(uthmani ? { records, chapters } : {}) };
}

module.exports = { SCRIPTS, editionPart, normalizeRefs, normalizeSlug, passage };
