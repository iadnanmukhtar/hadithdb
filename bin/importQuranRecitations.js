#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('../lib/Globals');
const QuranRecitations = require('../lib/QuranRecitations');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'temp'));
const SOURCES = [
	{ directory: 'abbad', slug: 'abbad', name: 'Abbad', reciter: 'Fares Abbad' },
	{ directory: 'alili', slug: 'alili', name: 'Alili', reciter: 'Aziz Alili' },
	{ directory: 'banna', slug: 'banna', name: 'Al-Banna', reciter: 'Mahmoud Ali al-Banna' },
	{ directory: 'jalil', slug: 'jalil', name: 'Al-Jalil', reciter: 'Khalid al-Jalil' },
	{ directory: 'qatami', slug: 'qatami', name: 'Al-Qatami', reciter: 'Nasser al-Qatami' },
	{ directory: 'yasir', slug: 'yasir', name: 'Yasin', reciter: 'Sahl Yasin' }
];
const MAX_SEGMENT_OVERLAP_MS = 250;
const TRACK_DURATION_TOLERANCE_MS = 2000;
function readJson(filename) {
	if (!fs.existsSync(filename))
		throw new Error(`Missing recitation metadata: ${filename}`);
	return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function sql(value) {
	return QuranRecitations.sql(value);
}

function chunks(items, size) {
	const result = [];
	for (let index = 0; index < items.length; index += size)
		result.push(items.slice(index, index + size));
	return result;
}

async function insertRows(table, columns, rows, updateColumns) {
	for (const batch of chunks(rows, 1000)) {
		const values = batch.map(row => `(${columns.map(column => sql(row[column])).join(',')})`).join(',');
		const updates = updateColumns.map(column => `${column}=VALUES(${column})`).join(',');
		await global.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values} ON DUPLICATE KEY UPDATE ${updates}`);
	}
}

function normalizedSource(source, ordinal) {
	const directory = path.join(root, source.directory);
	const tracksJson = readJson(path.join(directory, 'surah.json'));
	const segmentsJson = readJson(path.join(directory, 'segments.json'));
	const tracks = Object.entries(tracksJson)
		.filter(([surah]) => Number(surah) >= 1 && Number(surah) <= 114)
		.map(([surah, track]) => ({
			surah: Number(surah),
			audio_url: String(track.audio_url || '').replace(/([^:]\/)\/+/g, '$1'),
			duration_ms: Number.isFinite(Number(track.duration)) ? Math.round(Number(track.duration) * 1000) : null
		}));
	const segments = Object.entries(segmentsJson).map(([verseKey, segment]) => {
		const [surah, ayah] = verseKey.split(':').map(Number);
		return {
			surah,
			ayah,
			start_ms: Number(segment.timestamp_from),
			end_ms: Number(segment.timestamp_to)
		};
	});
	if (tracks.length !== 114 || segments.length !== 6236)
		throw new Error(`${source.directory} is incomplete: ${tracks.length} tracks, ${segments.length} ayah segments`);
	if (tracks.some(track => !track.audio_url) || segments.some(segment =>
		!Number.isInteger(segment.surah) || !Number.isInteger(segment.ayah) ||
		!Number.isFinite(segment.start_ms) || !Number.isFinite(segment.end_ms) ||
		segment.start_ms < 0 || segment.end_ms <= segment.start_ms))
		throw new Error(`${source.directory} contains invalid track or segment metadata`);
	const tracksBySurah = new Map(tracks.map(track => [track.surah, track]));
	const segmentsBySurah = new Map();
	segments.forEach(segment => {
		if (!segmentsBySurah.has(segment.surah))
			segmentsBySurah.set(segment.surah, []);
		segmentsBySurah.get(segment.surah).push(segment);
	});
	for (let surah = 1; surah <= 114; surah += 1) {
		const track = tracksBySurah.get(surah);
		const surahSegments = (segmentsBySurah.get(surah) || []).sort((left, right) => left.ayah - right.ayah);
		if (!track || !surahSegments.length || surahSegments.some((segment, index) => segment.ayah !== index + 1))
			throw new Error(`${source.directory} has missing or non-sequential segments for surah ${surah}`);
		for (let index = 1; index < surahSegments.length; index += 1) {
			const overlap = surahSegments[index - 1].end_ms - surahSegments[index].start_ms;
			if (overlap > MAX_SEGMENT_OVERLAP_MS)
				throw new Error(`${source.directory} has corrupt overlapping segments at ${surah}:${surahSegments[index].ayah} (${overlap}ms)`);
		}
		const finalEnd = surahSegments[surahSegments.length - 1].end_ms;
		if (Number.isInteger(track.duration_ms) && finalEnd > track.duration_ms + TRACK_DURATION_TOLERANCE_MS)
			throw new Error(`${source.directory} has segment timing beyond surah ${surah} audio duration`);
	}
	const firstUrl = new URL(tracks[0].audio_url);
	const lastSlash = firstUrl.pathname.lastIndexOf('/');
	const audioBaseUrl = `${firstUrl.origin}${firstUrl.pathname.slice(0, lastSlash + 1)}`;
	const firstFilename = firstUrl.pathname.slice(lastSlash + 1);
	const paddedPattern = firstFilename.replace('001', '{surah:03}');
	const unpaddedPattern = firstFilename.replace(/^1(?=\D|$)/, '{surah}');
	const audioPattern = paddedPattern.includes('{surah:03}') ? paddedPattern : unpaddedPattern;
	if (!audioPattern.includes('{surah') || tracks.some(track =>
		`${audioBaseUrl}${audioPattern
			.replace('{surah:03}', String(track.surah).padStart(3, '0'))
			.replace('{surah}', String(track.surah))}` !== track.audio_url))
		throw new Error(`${source.directory} does not use one consistent surah audio URL pattern`);
	return Object.assign({}, source, {
		ordinal,
		source: new URL(audioBaseUrl).hostname,
		audioBaseUrl,
		audioPattern,
		tracks,
		segments
	});
}

async function run() {
	const sources = SOURCES.map((source, index) => normalizedSource(source, index + 1));
	await QuranRecitations.ensureTables();
	for (const source of sources) {
			const result = await global.query(`
				INSERT INTO quran_recitations (slug, name, reciter_name, source, audio_base_url, surah_audio_pattern, ordinal, enabled)
				VALUES (${sql(source.slug)}, ${sql(source.name)}, ${sql(source.reciter)}, ${sql(source.source)},
					${sql(source.audioBaseUrl)}, ${sql(source.audioPattern)}, ${source.ordinal}, 0)
				ON DUPLICATE KEY UPDATE name=VALUES(name), reciter_name=VALUES(reciter_name),
					source=VALUES(source), audio_base_url=VALUES(audio_base_url),
					surah_audio_pattern=VALUES(surah_audio_pattern), ordinal=VALUES(ordinal), id=LAST_INSERT_ID(id)`);
			const recitationId = Number(result.insertId);
			if (!Number.isInteger(recitationId) || recitationId < 1)
				throw new Error(`Unable to resolve imported recitation id for ${source.slug}`);
			await insertRows('quran_recitation_tracks', ['recitation_id', 'surah', 'audio_url', 'duration_ms'],
				source.tracks.map(track => Object.assign({ recitation_id: recitationId }, track)),
				['audio_url', 'duration_ms']);
			await insertRows('quran_recitation_segments', ['recitation_id', 'surah', 'ayah', 'start_ms', 'end_ms'],
				source.segments.map(segment => Object.assign({ recitation_id: recitationId }, segment)),
				['start_ms', 'end_ms']);
			const imported = (await global.query(`
				SELECT COUNT(DISTINCT track.surah) AS tracks, COUNT(segment.ayah) AS segments
				FROM quran_recitation_tracks track
				LEFT JOIN quran_recitation_segments segment
					ON segment.recitation_id=track.recitation_id AND segment.surah=track.surah
				WHERE track.recitation_id=${recitationId}`))[0];
			if (Number(imported.tracks) !== 114 || Number(imported.segments) !== 6236)
				throw new Error(`${source.slug} import verification failed: ${imported.tracks} tracks, ${imported.segments} segments`);
			await global.query(`UPDATE quran_recitations SET enabled=1 WHERE id=${recitationId}`);
	}
	console.log(`Imported ${sources.length} playable continuous recitations, ${sources.length * 114} surah tracks, and ${sources.length * 6236} ayah segments.`);
}

run().catch(err => {
	console.error(err.stack || err.message || err);
	process.exitCode = 1;
}).finally(() => {
	if (global.dbPool)
		global.dbPool.end();
});
