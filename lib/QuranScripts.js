'use strict';

const MySQL = require('mysql');

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

async function passage(slug, refs) {
	slug = normalizeSlug(slug);
	refs = normalizeRefs(refs);
	if (!slug || refs.length < 1)
		return { script: SCRIPTS[slug] || null, ayahsByRef: {}, wordsByAyah: {} };
	const script = SCRIPTS[slug];
	const bodyColumn = BODY_COLUMNS[slug];
	const refsSql = refs.map(MySQL.escape).join(',');
	const slugSql = MySQL.escape(slug);
	const [ayahs, words] = await Promise.all([
		global.query(`
			SELECT h.num AS ref, h.${bodyColumn} AS text
			FROM hadiths h
			JOIN toc t ON h.tocId=t.id
			WHERE t.bookId=0 AND h.num IN (${refsSql})
			ORDER BY h.ordinal`),
		global.query(`
			SELECT surah, ayah, word, text
			FROM quran_corpus_script_words
			WHERE script_slug=${slugSql} AND CONCAT(surah, ':', ayah) IN (${refsSql})
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

module.exports = { SCRIPTS, normalizeRefs, normalizeSlug, passage };
