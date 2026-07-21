'use strict';

const MySQL = require('mysql');
const Utils = require('./Utils');

const ARABIC_WORD_RE = /[\u0621-\u064A\u0671-\u06D3\u06FA-\u06FC]/;

class QuranCorpus {
	static async ensureTable() {
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_corpus_words (
				id INT NOT NULL AUTO_INCREMENT,
				surah SMALLINT NOT NULL,
				ayah SMALLINT NOT NULL,
				word SMALLINT NOT NULL,
				corpus_id VARCHAR(16) NOT NULL,
				text VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
				text_alt VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				ayah_text_simple MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				parts_of_speech VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				meaning_en VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
				lemma VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				root VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				pos VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				stem VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_pos VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_parts_of_speech VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_stem VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				prefix1 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				prefix2 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				prefix3 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				prefix4 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				suffix1 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				suffix2 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				suffix3 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_prefix1 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_prefix2 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_prefix3 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_prefix4 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_suffix1 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_suffix2 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				grammar_suffix3 VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				UNIQUE KEY uq_quran_corpus_word (surah, ayah, word),
				KEY ndx_quran_corpus_ref (surah, ayah)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		try {
			await global.query(`
				ALTER TABLE quran_corpus_words
				ADD COLUMN ayah_text_simple MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER text`);
		} catch (err) {
			if (!err || err.code !== 'ER_DUP_FIELDNAME')
				throw err;
		}
		await QuranCorpus.ensureColumn('text_alt', "VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER text");
		await QuranCorpus.ensureColumn('grammar_pos', "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER stem");
		await QuranCorpus.ensureColumn('grammar_parts_of_speech', "VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_pos");
		await QuranCorpus.ensureColumn('grammar_stem', "VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_parts_of_speech");
		await QuranCorpus.ensureColumn('grammar_prefix1', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER suffix3");
		await QuranCorpus.ensureColumn('grammar_prefix2', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_prefix1");
		await QuranCorpus.ensureColumn('grammar_prefix3', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_prefix2");
		await QuranCorpus.ensureColumn('grammar_prefix4', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_prefix3");
		await QuranCorpus.ensureColumn('grammar_suffix1', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_prefix4");
		await QuranCorpus.ensureColumn('grammar_suffix2', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_suffix1");
		await QuranCorpus.ensureColumn('grammar_suffix3', "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER grammar_suffix2");
	}

	static async hydrateItems(items) {
		if (!Array.isArray(items) || items.length < 1)
			return items;
		const refs = items
			.filter(item => item && item.book_alias === 'quran')
			.map(item => QuranCorpus.parseRef(item.num || item.ref))
			.filter(Boolean);
		if (refs.length < 1)
			return items;
		const conditions = Array.from(new Set(refs.map(ref => `${ref.surah}:${ref.ayah}`)))
			.map(ref => {
				const parts = ref.split(':');
				return `(surah=${parseInt(parts[0], 10)} AND ayah=${parseInt(parts[1], 10)})`;
			});
		try {
			const rows = await global.query(`
				SELECT surah, ayah, word, text, meaning_en, parts_of_speech, lemma, root, pos, stem,
					grammar_pos, grammar_parts_of_speech, grammar_stem
				FROM quran_corpus_words
				WHERE ${conditions.join(' OR ')}
				ORDER BY surah, ayah, word`);
			const byRef = new Map();
			rows.forEach(row => {
				const key = `${row.surah}:${row.ayah}`;
				if (!byRef.has(key))
					byRef.set(key, []);
				byRef.get(key).push(row);
			});
			items.forEach(item => {
				const ref = QuranCorpus.parseRef(item && (item.num || item.ref));
				if (!ref)
					return;
				item.quranCorpusWords = byRef.get(`${ref.surah}:${ref.ayah}`) || [];
			});
		} catch (err) {
			if (err && err.code === 'ER_NO_SUCH_TABLE')
				return items;
			throw err;
		}
		return items;
	}

	static async wordsForRange(surah, startAyah, endAyah) {
		surah = parseInt(surah, 10);
		startAyah = parseInt(startAyah, 10);
		endAyah = parseInt(endAyah, 10);
		if (!Number.isInteger(surah) || !Number.isInteger(startAyah) || !Number.isInteger(endAyah))
			return [];
		if (endAyah < startAyah)
			return [];
		try {
			return await global.query(`
				SELECT surah, ayah, word, text, meaning_en, parts_of_speech, lemma, root, pos, stem,
					grammar_pos, grammar_parts_of_speech, grammar_stem,
					prefix1, prefix2, prefix3, prefix4, suffix1, suffix2, suffix3,
					grammar_prefix1, grammar_prefix2, grammar_prefix3, grammar_prefix4,
					grammar_suffix1, grammar_suffix2, grammar_suffix3
				FROM quran_corpus_words
				WHERE surah=${surah}
				  AND ayah BETWEEN ${startAyah} AND ${endAyah}
				ORDER BY ayah, word`);
		} catch (err) {
			if (err && err.code === 'ER_NO_SUCH_TABLE')
				return [];
			throw err;
		}
	}

	static wordsByAyah(rows) {
		const out = {};
		(rows || []).forEach(row => {
			const key = `${row.surah}:${row.ayah}`;
			if (!out[key])
				out[key] = [];
			out[key].push({
				word: row.word,
				text: row.text,
				translation: row.meaning_en,
				partsOfSpeech: row.parts_of_speech,
				lemma: row.lemma,
				root: row.root,
				pos: row.pos,
				stem: row.stem,
				grammarPos: row.grammar_pos,
				grammar: row.grammar_parts_of_speech,
				grammarStem: row.grammar_stem,
				prefixes: [row.prefix4, row.prefix3, row.prefix2, row.prefix1].filter(Boolean),
				suffixes: [row.suffix1, row.suffix2, row.suffix3].filter(Boolean),
				grammarPrefixes: [row.grammar_prefix4, row.grammar_prefix3, row.grammar_prefix2, row.grammar_prefix1].filter(Boolean),
				grammarSuffixes: [row.grammar_suffix1, row.grammar_suffix2, row.grammar_suffix3].filter(Boolean)
			});
		});
		return out;
	}

	static parseRef(ref) {
		const parts = Utils.emptyIfNull(ref).toString().replace(/^quran:/, '').split(/:/);
		if (parts.length < 2)
			return null;
		const surah = parseInt(parts[0], 10);
		const ayah = parseInt(parts[1], 10);
		if (!Number.isInteger(surah) || !Number.isInteger(ayah))
			return null;
		return { surah, ayah };
	}

	static renderArabicBodyWithTooltips(markdown, words) {
		return Utils.markdownToHtml(markdown);
	}

	static sqlValue(value) {
		value = Utils.emptyIfNull(value).toString().trim();
		return value ? MySQL.escape(value) : 'NULL';
	}

	static async ensureColumn(name, definition) {
		try {
			await global.query(`ALTER TABLE quran_corpus_words ADD COLUMN ${name} ${definition}`);
		} catch (err) {
			if (!err || err.code !== 'ER_DUP_FIELDNAME')
				throw err;
		}
	}
}

module.exports = QuranCorpus;
