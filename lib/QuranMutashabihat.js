'use strict';

const Arabic = require('./Arabic');
const Index = require('./Index');

const QURAN_INDEX = 'hadiths';

class QuranMutashabihat {
	static async ensureTables() {
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_mutashabihat_phrases (
				id INT UNSIGNED NOT NULL,
				source_hadith_id INT NOT NULL,
				source_word_from SMALLINT UNSIGNED NOT NULL,
				source_word_to SMALLINT UNSIGNED NOT NULL,
				surah_count SMALLINT UNSIGNED NOT NULL,
				ayah_count SMALLINT UNSIGNED NOT NULL,
				occurrence_count SMALLINT UNSIGNED NOT NULL,
				updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				KEY ndx_quran_mutashabihat_source (source_hadith_id),
				CONSTRAINT fk_quran_mutashabihat_source FOREIGN KEY (source_hadith_id) REFERENCES hadiths (id) ON DELETE CASCADE ON UPDATE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_mutashabihat_occurrences (
				phrase_id INT UNSIGNED NOT NULL,
				hadith_id INT NOT NULL,
				ayah_phrase_ordinal SMALLINT UNSIGNED NOT NULL,
				occurrence_ordinal SMALLINT UNSIGNED NOT NULL,
				word_from SMALLINT UNSIGNED NOT NULL,
				word_to SMALLINT UNSIGNED NOT NULL,
				PRIMARY KEY (phrase_id, hadith_id, occurrence_ordinal),
				KEY ndx_quran_mutashabihat_ayah (hadith_id, ayah_phrase_ordinal),
				CONSTRAINT fk_quran_mutashabihat_phrase FOREIGN KEY (phrase_id) REFERENCES quran_mutashabihat_phrases (id) ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT fk_quran_mutashabihat_ayah FOREIGN KEY (hadith_id) REFERENCES hadiths (id) ON DELETE CASCADE ON UPDATE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
	}

	static parseRef(value) {
		const match = Arabic.toLatinDigits((value || '').toString()).replace(/^quran:/, '').match(/^(\d{1,3}):(\d{1,3})$/);
		if (!match)
			return null;
		const surah = Number(match[1]);
		const ayah = Number(match[2]);
		return Number.isInteger(surah) && Number.isInteger(ayah) && surah > 0 && ayah > 0
			? { surah, ayah }
			: null;
	}

	static async forAyah(value) {
		const ref = QuranMutashabihat.parseRef(value && (value.num || value.ref || value));
		if (!ref)
			return [];
		let sourceId = Number(value && (value.hId || value.id));
		if (!Number.isInteger(sourceId)) {
			const sources = await Index.docsFromQueryString(QURAN_INDEX, `book_alias:quran AND num:"${ref.surah}:${ref.ayah}"`, 0, 1);
			sourceId = Number(sources[0] && (sources[0].hId || sources[0].id || sources[0]._id));
		}
		if (!Number.isInteger(sourceId))
			return [];

		let phraseRows;
		try {
			phraseRows = await global.query(`
				SELECT phrase.id, phrase.source_word_from, phrase.source_word_to,
					phrase.surah_count, phrase.ayah_count, phrase.occurrence_count,
					occ.ayah_phrase_ordinal, occ.word_from, occ.word_to
				FROM quran_mutashabihat_occurrences occ
				JOIN quran_mutashabihat_phrases phrase ON phrase.id=occ.phrase_id
				WHERE occ.hadith_id=${sourceId}
				ORDER BY occ.ayah_phrase_ordinal, phrase.id, occ.occurrence_ordinal`);
		} catch (err) {
			if (err && err.code === 'ER_NO_SUCH_TABLE')
				return [];
			throw err;
		}
		if (phraseRows.length < 1)
			return [];

		const phraseIds = Array.from(new Set(phraseRows.map(row => Number(row.id))));
		const occurrences = await global.query(`
			SELECT phrase_id, hadith_id, occurrence_ordinal, word_from, word_to
			FROM quran_mutashabihat_occurrences
			WHERE phrase_id IN (${phraseIds.join(',')})
			  AND hadith_id<>${sourceId}
			ORDER BY phrase_id, hadith_id, occurrence_ordinal`);
		const matchedIds = Array.from(new Set(occurrences.map(row => Number(row.hadith_id))));
		const documents = matchedIds.length > 0
			? await Index.docsFromIdArray(QURAN_INDEX, matchedIds, 0, matchedIds.length)
			: [];
		const documentsById = new Map(documents.map(document => [Number(document.hId || document.id || document._id), document]));
		const phrasesById = new Map();
		phraseRows.forEach(row => {
			const id = Number(row.id);
			if (!phrasesById.has(id)) {
				phrasesById.set(id, {
					id,
					sourceWordFrom: Number(row.source_word_from),
					sourceWordTo: Number(row.source_word_to),
					surahCount: Number(row.surah_count),
					ayahCount: Number(row.ayah_count),
					occurrenceCount: Number(row.occurrence_count),
					ayahPhraseOrdinal: Number(row.ayah_phrase_ordinal),
					sourceRanges: [],
					matches: []
				});
			}
			phrasesById.get(id).sourceRanges.push([Number(row.word_from), Number(row.word_to)]);
		});
		const matchesByPhraseAndAyah = new Map();
		occurrences.forEach(row => {
			const phrase = phrasesById.get(Number(row.phrase_id));
			const document = documentsById.get(Number(row.hadith_id));
			if (!phrase || !document)
				return;
			const key = `${row.phrase_id}:${row.hadith_id}`;
			let match = matchesByPhraseAndAyah.get(key);
			if (!match) {
				match = { document, ranges: [] };
				matchesByPhraseAndAyah.set(key, match);
				phrase.matches.push(match);
			}
			match.ranges.push([Number(row.word_from), Number(row.word_to)]);
		});
		return Array.from(phrasesById.values()).sort((a, b) => a.ayahPhraseOrdinal - b.ayahPhraseOrdinal || a.id - b.id);
	}
}

module.exports = QuranMutashabihat;
