'use strict';

const Arabic = require('./Arabic');
const Index = require('./Index');

const QURAN_INDEX = 'hadiths';

class QuranSimilarAyahs {
	static async ensureColumns() {
		for (const definition of [
			"similarity_source VARCHAR(64) DEFAULT NULL",
			"similarity_imported TINYINT(1) NOT NULL DEFAULT 0",
			"similarity_ordinal SMALLINT UNSIGNED DEFAULT NULL",
			"matched_words_count SMALLINT UNSIGNED DEFAULT NULL",
			"coverage DECIMAL(6,2) UNSIGNED DEFAULT NULL",
			"similarity_score DECIMAL(6,2) UNSIGNED DEFAULT NULL",
			"match_words TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL"
		]) {
			try {
				await global.query(`ALTER TABLE hadiths_sim ADD COLUMN ${definition}`);
			} catch (err) {
				if (!err || err.code !== 'ER_DUP_FIELDNAME')
					throw err;
			}
		}
		try {
			await global.query('ALTER TABLE hadiths_sim ADD KEY ndx_hadiths_sim_source_order (similarity_source, hadithId1, similarity_ordinal)');
		} catch (err) {
			if (!err || err.code !== 'ER_DUP_KEYNAME')
				throw err;
		}
	}

	static parseRef(value) {
		const match = Arabic.toLatinDigits((value || '').toString())
			.replace(/^quran:/, '')
			.match(/^(\d{1,3}):(\d{1,3})$/);
		if (!match)
			return null;
		const surah = Number(match[1]);
		const ayah = Number(match[2]);
		return Number.isInteger(surah) && Number.isInteger(ayah) && surah > 0 && ayah > 0
			? { surah, ayah }
			: null;
	}

	static async forAyah(value) {
		const ref = QuranSimilarAyahs.parseRef(value && (value.num || value.ref || value));
		if (!ref)
			return [];
		let sourceId = Number(value && (value.hId || value.id));
		if (!Number.isInteger(sourceId)) {
			const sources = await Index.docsFromQueryString(
				QURAN_INDEX,
				`book_alias:quran AND num:"${ref.surah}:${ref.ayah}"`,
				0,
				1
			);
			sourceId = Number(sources[0] && (sources[0].hId || sources[0].id || sources[0]._id));
		}
		if (!Number.isInteger(sourceId))
			return [];
		let relationships;
		try {
			relationships = await global.query(`
				SELECT sim.hadithId2,
					sim.similarity_ordinal AS similar_ordinal,
					sim.matched_words_count AS similar_matched_words_count,
					sim.coverage AS similar_coverage,
					sim.similarity_score AS similar_score,
					sim.match_words AS similar_match_words
				FROM hadiths_sim sim
				WHERE sim.hadithId1=${sourceId}
				  AND sim.similarity_source='qul_similar_ayah'
				ORDER BY sim.similarity_ordinal`);
		} catch (err) {
			if (err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE'))
				return [];
			throw err;
		}
		if (relationships.length < 1)
			return [];
		const ids = relationships.map(row => Number(row.hadithId2)).filter(Number.isInteger);
		const documents = await Index.docsFromIdArray(QURAN_INDEX, ids, 0, ids.length);
		const documentsById = new Map(documents.map(document => [
			Number(document.hId || document.id || document._id),
			document
		]));
		return relationships.flatMap(relationship => {
			const document = documentsById.get(Number(relationship.hadithId2));
			return document ? [{ ...document, ...relationship }] : [];
		});
	}
}

module.exports = QuranSimilarAyahs;
