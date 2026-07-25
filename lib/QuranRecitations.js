'use strict';

const MySQL = require('mysql');

class QuranRecitations {
	static async ensureTables() {
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_recitations (
				id INT NOT NULL AUTO_INCREMENT,
				slug VARCHAR(64) NOT NULL,
				name VARCHAR(128) NOT NULL,
				reciter_name VARCHAR(128) NOT NULL,
				source VARCHAR(255) DEFAULT NULL,
				audio_base_url VARCHAR(1024) DEFAULT NULL,
				surah_audio_pattern VARCHAR(128) DEFAULT NULL,
				ordinal SMALLINT NOT NULL DEFAULT 0,
				enabled TINYINT(1) NOT NULL DEFAULT 1,
				updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				UNIQUE KEY ndx_quran_recitations_slug (slug)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		const columns = new Set((await global.query('SHOW COLUMNS FROM quran_recitations')).map(column => column.Field));
		if (!columns.has('audio_base_url'))
			await global.query('ALTER TABLE quran_recitations ADD COLUMN audio_base_url VARCHAR(1024) DEFAULT NULL AFTER source');
		if (!columns.has('surah_audio_pattern'))
			await global.query('ALTER TABLE quran_recitations ADD COLUMN surah_audio_pattern VARCHAR(128) DEFAULT NULL AFTER audio_base_url');
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_recitation_tracks (
				recitation_id INT NOT NULL,
				surah SMALLINT NOT NULL,
				audio_url VARCHAR(1024) NOT NULL,
				duration_ms INT DEFAULT NULL,
				PRIMARY KEY (recitation_id, surah),
				CONSTRAINT fk_quran_recitation_tracks_recitation
					FOREIGN KEY (recitation_id) REFERENCES quran_recitations(id) ON DELETE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		await global.query(`
			CREATE TABLE IF NOT EXISTS quran_recitation_segments (
				recitation_id INT NOT NULL,
				surah SMALLINT NOT NULL,
				ayah SMALLINT NOT NULL,
				start_ms INT NOT NULL,
				end_ms INT NOT NULL,
				PRIMARY KEY (recitation_id, surah, ayah),
				KEY ndx_quran_recitation_segments_range (recitation_id, surah, start_ms),
				CONSTRAINT fk_quran_recitation_segments_track
					FOREIGN KEY (recitation_id, surah)
					REFERENCES quran_recitation_tracks(recitation_id, surah) ON DELETE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
	}

	static async list() {
		await QuranRecitations.ensureTables();
		return global.query(`
			SELECT slug AS id, slug, name AS shortName, reciter_name, name AS label
			FROM quran_recitations
			WHERE enabled=1
			ORDER BY name, slug`);
	}

	static async passage(slug, surah, ayahFrom, ayahTo) {
		await QuranRecitations.ensureTables();
		const rows = await global.query(`
			SELECT CONCAT(segment.surah, ':', segment.ayah) AS verseKey,
				segment.surah, segment.ayah,
				recitation.audio_base_url, recitation.surah_audio_pattern,
				segment.start_ms AS startMs, segment.end_ms AS endMs
			FROM quran_recitations recitation
			JOIN quran_recitation_segments segment ON segment.recitation_id=recitation.id
			JOIN quran_recitation_tracks track
				ON track.recitation_id=segment.recitation_id AND track.surah=segment.surah
			WHERE recitation.slug=${QuranRecitations.sql(slug)}
				AND recitation.enabled=1
				AND segment.surah=${Number(surah)}
				AND segment.ayah BETWEEN ${Number(ayahFrom)} AND ${Number(ayahTo)}
			ORDER BY segment.ayah`);
		return rows.map(row => ({
			verseKey: row.verseKey,
			ayah: row.ayah,
			url: QuranRecitations.audioUrl(row.audio_base_url, row.surah_audio_pattern, row.surah),
			startMs: row.startMs,
			endMs: row.endMs
		}));
	}

	static audioUrl(baseUrl, pattern, surah) {
		const padded = String(Number(surah)).padStart(3, '0');
		return `${baseUrl || ''}${(pattern || '').replace('{surah:03}', padded).replace('{surah}', String(Number(surah)))}`;
	}

	static sql(value) {
		return MySQL.escape(value);
	}
}

module.exports = QuranRecitations;
