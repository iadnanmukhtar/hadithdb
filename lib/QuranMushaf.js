'use strict';

const MySQL = require('mysql');

let infoCache;
const pageCache = new Map();
const pageLoading = new Map();
const pageForRefCache = new Map();
const sectionForPageCache = new Map();

function clone(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value));
}

class QuranMushaf {
	static async ensureTables() {
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_mushaf_info (
				id SMALLINT NOT NULL DEFAULT 1,
				name VARCHAR(255) NOT NULL,
				number_of_pages SMALLINT NOT NULL,
				lines_per_page SMALLINT NOT NULL,
				font_name VARCHAR(128) NOT NULL,
				updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				PRIMARY KEY (id)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_mushaf_pages (
				page_number SMALLINT NOT NULL,
				line_number SMALLINT NOT NULL,
				line_type VARCHAR(16) NOT NULL,
				is_centered TINYINT(1) NOT NULL DEFAULT 0,
				first_word_id INT DEFAULT NULL,
				last_word_id INT DEFAULT NULL,
				surah_number SMALLINT DEFAULT NULL,
				PRIMARY KEY (page_number, line_number),
				KEY ndx_quran_mushaf_word_range (first_word_id, last_word_id)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_mushaf_words (
				global_word_id INT NOT NULL,
				surah SMALLINT NOT NULL,
				ayah SMALLINT NOT NULL,
				word SMALLINT DEFAULT NULL,
				corpus_word_id INT DEFAULT NULL,
				source_text VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
				source_meaning_en VARCHAR(128) DEFAULT NULL,
				source_grammar VARCHAR(128) DEFAULT NULL,
				is_ayah_marker TINYINT(1) NOT NULL DEFAULT 0,
				PRIMARY KEY (global_word_id),
				KEY ndx_quran_mushaf_ref (surah, ayah, word)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		await QuranMushaf.ensureSectionTable();
		const columns = new Set((await global.query('SHOW COLUMNS FROM quran_mushaf_words')).map(column => column.Field));
		for (const [name, definition] of [
			['source_text', 'source_text VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER corpus_word_id'],
			['source_meaning_en', 'source_meaning_en VARCHAR(128) DEFAULT NULL AFTER source_text'],
			['source_grammar', 'source_grammar VARCHAR(128) DEFAULT NULL AFTER source_meaning_en']
		]) {
			if (!columns.has(name))
				await global.query(`ALTER TABLE quran_mushaf_words ADD COLUMN ${definition}`);
		}
	}

	static async ensureSectionTable() {
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_mushaf_sections (
				surah SMALLINT NOT NULL,
				h2 SMALLINT NOT NULL,
				start_ayah SMALLINT NOT NULL,
				page_number SMALLINT NOT NULL,
				updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				PRIMARY KEY (surah, h2),
				KEY ndx_quran_mushaf_section_page (page_number)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
	}

	static async info() {
		if (infoCache !== undefined)
			return clone(infoCache);
		try {
			infoCache = (await global.query('SELECT * FROM quran_mushaf_info WHERE id=1 LIMIT 1'))[0] || null;
			return clone(infoCache);
		} catch (err) {
			if (err && err.code === 'ER_NO_SUCH_TABLE')
				return null;
			throw err;
		}
	}

	static async page(number) {
		number = Number(number);
		if (!Number.isInteger(number) || number < 1)
			return null;
		const info = await QuranMushaf.info();
		if (!info || number > Number(info.number_of_pages))
			return null;
		if (pageCache.has(number))
			return clone(pageCache.get(number));
		if (pageLoading.has(number))
			return clone(await pageLoading.get(number));
		const loading = QuranMushaf.loadPage(number, info);
		pageLoading.set(number, loading);
		try {
			const page = await loading;
			pageCache.set(number, page);
			return clone(page);
		} finally {
			pageLoading.delete(number);
		}
	}

	static async loadPage(number, info) {
		const lines = await global.query(`
			SELECT page_number, line_number, line_type, is_centered,
				first_word_id, last_word_id, surah_number
			FROM quran_mushaf_pages
			WHERE page_number=${number}
			ORDER BY line_number`);
		const words = await global.query(`
			SELECT line.line_number, map.global_word_id, map.surah, map.ayah, map.word,
				map.is_ayah_marker, COALESCE(map.source_text, corpus.text) AS text,
				COALESCE(map.source_meaning_en, corpus.meaning_en) AS meaning_en,
				corpus.parts_of_speech,
				COALESCE(map.source_grammar, corpus.grammar_parts_of_speech) AS grammar_parts_of_speech
			FROM quran_mushaf_pages line
			JOIN quran_mushaf_words map
			  ON map.global_word_id BETWEEN line.first_word_id AND line.last_word_id
			LEFT JOIN quran_corpus_words corpus ON corpus.id=map.corpus_word_id
			WHERE line.page_number=${number} AND line.line_type='ayah'
			ORDER BY line.line_number, map.global_word_id`);
		const wordsByLine = new Map();
		words.forEach(word => {
			if (!wordsByLine.has(Number(word.line_number)))
				wordsByLine.set(Number(word.line_number), []);
			wordsByLine.get(Number(word.line_number)).push(word);
		});
		lines.forEach(line => {
			line.words = wordsByLine.get(Number(line.line_number)) || [];
		});
		if (number < Number(info.number_of_pages) && lines.length > 0 && lines[lines.length - 1].line_type === 'surah_name')
			lines.pop();
		if (number > 1) {
			const previousLastLine = (await global.query(`
				SELECT page_number, line_number, line_type, is_centered,
					first_word_id, last_word_id, surah_number
				FROM quran_mushaf_pages
				WHERE page_number=${number - 1}
				ORDER BY line_number DESC
				LIMIT 1`))[0];
			const firstAyahWord = lines.flatMap(line => line.words || []).find(word => !word.is_ayah_marker);
			if (previousLastLine
				&& previousLastLine.line_type === 'surah_name'
				&& firstAyahWord
				&& Number(previousLastLine.surah_number) === Number(firstAyahWord.surah)
				&& !lines.some(line => line.line_type === 'surah_name' && Number(line.surah_number) === Number(previousLastLine.surah_number))) {
				previousLastLine.line_number = 0;
				previousLastLine.words = [];
				lines.unshift(previousLastLine);
			}
		}
		var basmallahWords = [];
		if (lines.some(line => line.line_type === 'surah_name' && ![1, 9].includes(Number(line.surah_number)))) {
			basmallahWords = await global.query(`
				SELECT map.surah, map.ayah, map.word,
					COALESCE(map.source_text, corpus.text) AS text,
					COALESCE(map.source_meaning_en, corpus.meaning_en) AS meaning_en,
					corpus.parts_of_speech,
					COALESCE(map.source_grammar, corpus.grammar_parts_of_speech) AS grammar_parts_of_speech
				FROM quran_mushaf_words map
				LEFT JOIN quran_corpus_words corpus ON corpus.id=map.corpus_word_id
				WHERE map.surah=1 AND map.ayah=1 AND map.is_ayah_marker=0
				ORDER BY map.global_word_id`);
		}
		return { info, number, lines, basmallahWords };
	}

	static async pageForRef(surah, ayah) {
		surah = Number(surah);
		ayah = Number(ayah);
		if (!Number.isInteger(surah) || !Number.isInteger(ayah) || surah < 1 || ayah < 1)
			return null;
		const key = `${surah}:${ayah}`;
		if (pageForRefCache.has(key))
			return pageForRefCache.get(key);
		const rows = await global.query(`
			SELECT page.page_number
			FROM quran_mushaf_words word
			JOIN quran_mushaf_pages page
			  ON word.global_word_id BETWEEN page.first_word_id AND page.last_word_id
			WHERE word.surah=${surah} AND word.ayah=${ayah}
			ORDER BY page.page_number
			LIMIT 1`);
		const pageNumber = rows[0] ? Number(rows[0].page_number) : null;
		pageForRefCache.set(key, pageNumber);
		return pageNumber;
	}

	static async pageForSection(surah, h2, startAyah) {
		surah = Number(surah);
		h2 = Number(h2);
		startAyah = Math.max(1, Number(startAyah) || 1);
		if (!Number.isInteger(surah) || !Number.isInteger(h2) || surah < 1 || h2 < 1)
			return null;
		await QuranMushaf.ensureSectionTable();
		const mapped = await global.query(`
			SELECT start_ayah, page_number FROM quran_mushaf_sections
			WHERE surah=${surah} AND h2=${h2} LIMIT 1`);
		if (mapped[0] && Number(mapped[0].start_ayah) === startAyah)
			return Number(mapped[0].page_number);
		const pageNumber = await QuranMushaf.pageForRef(surah, startAyah);
		if (!pageNumber)
			return null;
		await global.query(`
			INSERT INTO quran_mushaf_sections (surah, h2, start_ayah, page_number)
			VALUES (${surah}, ${h2}, ${startAyah}, ${pageNumber})
			ON DUPLICATE KEY UPDATE start_ayah=VALUES(start_ayah), page_number=VALUES(page_number)`);
		return pageNumber;
	}

	static async sectionForPage(pageNumber) {
		pageNumber = Number(pageNumber);
		if (!Number.isInteger(pageNumber) || pageNumber < 1)
			return null;
		if (sectionForPageCache.has(pageNumber))
			return clone(sectionForPageCache.get(pageNumber));
		await QuranMushaf.ensureSectionTable();
		const firstWords = await global.query(`
			SELECT word.surah, word.ayah
			FROM quran_mushaf_pages page
			JOIN quran_mushaf_words word
			  ON word.global_word_id BETWEEN page.first_word_id AND page.last_word_id
			WHERE page.page_number=${MySQL.escape(pageNumber)}
			  AND page.line_type='ayah'
			  AND word.is_ayah_marker=0
			ORDER BY page.line_number, word.global_word_id
			LIMIT 1`);
		if (firstWords[0]) {
			const firstWord = firstWords[0];
			const sections = await global.query(`
				SELECT section.*,
					GREATEST(1, CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED)) AS mushaf_start_ayah
				FROM v_toc section
				WHERE section.book_alias='quran'
				  AND section.level=2
				  AND section.h1=${MySQL.escape(Number(firstWord.surah))}
				  AND section.h2_start IS NOT NULL
				  AND section.h2_start<>''
				  AND GREATEST(1, CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED))<=${MySQL.escape(Number(firstWord.ayah))}
				ORDER BY mushaf_start_ayah DESC, section.h2 DESC
				LIMIT 1`);
			if (sections[0]) {
				const section = sections[0];
				const startAyah = Number(section.mushaf_start_ayah) || 1;
				const mappedPage = await QuranMushaf.pageForRef(section.h1, startAyah) || pageNumber;
				const currentMappings = await global.query(`
					SELECT start_ayah, page_number
					FROM quran_mushaf_sections
					WHERE surah=${MySQL.escape(Number(section.h1))}
					  AND h2=${MySQL.escape(Number(section.h2))}
					LIMIT 1`);
				if (!currentMappings[0]
					|| Number(currentMappings[0].start_ayah) !== startAyah
					|| Number(currentMappings[0].page_number) !== mappedPage) {
					await global.query(`
						INSERT INTO quran_mushaf_sections (surah, h2, start_ayah, page_number)
						VALUES (${MySQL.escape(Number(section.h1))}, ${MySQL.escape(Number(section.h2))}, ${MySQL.escape(startAyah)}, ${MySQL.escape(mappedPage)})
						ON DUPLICATE KEY UPDATE start_ayah=VALUES(start_ayah), page_number=VALUES(page_number)`);
				}
				section.start_ayah = startAyah;
				section.page_number = mappedPage;
				sectionForPageCache.set(pageNumber, section);
				return clone(section);
			}
		}
		const rows = await global.query(`
			SELECT surah, h2, start_ayah, page_number
			FROM quran_mushaf_sections
			WHERE page_number<=${pageNumber}
			ORDER BY page_number DESC, surah DESC, h2 DESC
			LIMIT 1`);
		const section = rows[0] || null;
		sectionForPageCache.set(pageNumber, section);
		return clone(section);
	}

	static async syncSectionMappings(surah) {
		surah = Number(surah);
		const scopedSurah = Number.isInteger(surah) && surah >= 1 && surah <= 114 ? surah : null;
		await QuranMushaf.ensureSectionTable();
		const headings = await global.query(`
			SELECT heading.h1 AS surah, heading.h2,
				GREATEST(1, CAST(SUBSTRING_INDEX(heading.start, ':', -1) AS UNSIGNED)) AS start_ayah,
				MIN(word.global_word_id) AS global_word_id
			FROM toc heading
			JOIN books book ON book.id=heading.bookId AND book.alias='quran'
			JOIN quran_mushaf_words word
			  ON word.surah=heading.h1
			 AND word.ayah=GREATEST(1, CAST(SUBSTRING_INDEX(heading.start, ':', -1) AS UNSIGNED))
			WHERE heading.level=2${scopedSurah ? ` AND heading.h1=${scopedSurah}` : ''}
			  AND heading.start IS NOT NULL AND heading.start<>''
			GROUP BY heading.h1, heading.h2, start_ayah`);
		const pageRanges = await global.query(`
			SELECT page_number, first_word_id, last_word_id
			FROM quran_mushaf_pages
			WHERE line_type='ayah'
			ORDER BY first_word_id`);
		const mappings = headings.map(heading => {
			const line = pageRanges.find(range => Number(heading.global_word_id) >= Number(range.first_word_id) && Number(heading.global_word_id) <= Number(range.last_word_id));
			return line ? [heading.surah, heading.h2, heading.start_ayah, line.page_number] : null;
		}).filter(Boolean);
		await global.query(`DELETE FROM quran_mushaf_sections${scopedSurah ? ` WHERE surah=${scopedSurah}` : ''}`);
		for (let offset = 0; offset < mappings.length; offset += 500) {
			const values = mappings.slice(offset, offset + 500).map(row => `(${row.map(QuranMushaf.sql).join(',')})`).join(',');
			if (values)
				await global.query(`INSERT INTO quran_mushaf_sections (surah, h2, start_ayah, page_number) VALUES ${values}`);
		}
		QuranMushaf.invalidateMappings();
		return mappings.length;
	}

	static invalidateMappings() {
		pageForRefCache.clear();
		sectionForPageCache.clear();
	}

	static invalidateAll() {
		infoCache = undefined;
		pageCache.clear();
		pageLoading.clear();
		QuranMushaf.invalidateMappings();
	}

	static sql(value) {
		return MySQL.escape(value);
	}
}

module.exports = QuranMushaf;
