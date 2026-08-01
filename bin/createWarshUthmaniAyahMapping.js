#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Arabic = require('../lib/Arabic');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_WARSH_FILE = path.join(ROOT, 'temp', 'warsh-ayat.json');
const DEFAULT_WARSH_WORD_FILE = path.join(ROOT, 'temp', 'warsh-words.json');
// The Indo-Pak source uses the same 6,236 Hafs/Uthmani ayah boundaries. Its
// glyph text is used only to locate those boundaries, never in the output.
const DEFAULT_UTHMANI_FILE = path.join(ROOT, 'temp', 'indopak-ayat.json');
const DEFAULT_OUTPUT_FILE = path.join(ROOT, 'temp', 'warsh-uthmani-ayah-mapping.json');
const DEFAULT_ALIGNED_AYAH_FILE = path.join(ROOT, 'temp', 'warsh-uthmani-ayat.json');
const DEFAULT_ALIGNED_WORD_FILE = path.join(ROOT, 'temp', 'warsh-uthmani-words.json');
const MIN_OVERLAP = 0.25;
const WARSH_BASMALA = Object.freeze(['بِسْمِ', 'اِ۬للَّهِ', 'اِ۬لرَّحْمَٰنِ', 'اِ۬لرَّحِيمِ']);

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	if (index < 0)
		return fallback;
	if (!process.argv[index + 1])
		throw new Error(`${name} requires a file path`);
	return path.resolve(process.argv[index + 1]);
}

function readJson(file, label) {
	if (!fs.existsSync(file) || fs.statSync(file).size < 1)
		throw new Error(`${label} is missing or empty: ${file}`);
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function positiveInteger(value, label) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1)
		throw new Error(`${label} must be a positive integer; received ${value}`);
	return number;
}

function loadAyahs(file, label) {
	const source = readJson(file, label);
	if (!source || Array.isArray(source) || typeof source !== 'object')
		throw new Error(`${label} must be an object keyed by surah:ayah`);
	const ayahs = Object.entries(source).map(([key, row]) => {
		const surah = positiveInteger(row && row.surah, `${label} ${key} surah`);
		const ayah = positiveInteger(row && row.ayah, `${label} ${key} ayah`);
		if (key !== `${surah}:${ayah}` || (row.verse_key && row.verse_key !== key))
			throw new Error(`${label} key mismatch at ${key}`);
		if (typeof row.text !== 'string' || row.text.trim() === '')
			throw new Error(`${label} ${key} must contain text`);
		return { ref: key, surah, ayah, text: row.text };
	}).sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
	const lastAyah = new Map();
	for (const row of ayahs) {
		const expected = (lastAyah.get(row.surah) || 0) + 1;
		if (row.ayah !== expected)
			throw new Error(`${label} ayahs are not contiguous at ${row.ref}; expected ${row.surah}:${expected}`);
		lastAyah.set(row.surah, row.ayah);
	}
	return ayahs;
}

function loadWords(file, label) {
	const source = readJson(file, label);
	if (!source || Array.isArray(source) || typeof source !== 'object')
		throw new Error(`${label} must be an object keyed by surah:ayah:word`);
	const words = Object.entries(source).map(([key, row]) => {
		const surah = positiveInteger(row && row.surah, `${label} ${key} surah`);
		const ayah = positiveInteger(row && row.ayah, `${label} ${key} ayah`);
		const word = positiveInteger(row && row.word, `${label} ${key} word`);
		if (key !== `${surah}:${ayah}:${word}` || (row.location && row.location !== key))
			throw new Error(`${label} key mismatch at ${key}`);
		if (typeof row.text !== 'string' || row.text === '')
			throw new Error(`${label} ${key} must contain text`);
		return { sourceId: positiveInteger(row.id, `${label} ${key} id`), sourceRef: key, surah, ayah, word, text: row.text };
	}).sort((a, b) => a.surah - b.surah || a.ayah - b.ayah || a.word - b.word);
	const lastWord = new Map();
	for (const row of words) {
		const ref = `${row.surah}:${row.ayah}`;
		const expected = (lastWord.get(ref) || 0) + 1;
		if (row.word !== expected)
			throw new Error(`${label} words are not contiguous at ${row.sourceRef}; expected ${ref}:${expected}`);
		lastWord.set(ref, row.word);
	}
	return words;
}

function normalize(text) {
	return Arabic.removeDelimetersInclSpace(Arabic.normalize(text || ''))
		.replace(/[يىئېےۓی]/gu, 'ي')
		.replace(/[كک]/gu, 'ك')
		.replace(/[هةھہۀۃ]/gu, 'ه')
		.replace(/[وؤ]/gu, 'و')
		.replace(/[اأإآٱ]/gu, 'ا')
		.replace(/للاه/gu, 'لله')
		.replace(/[\uE000-\uF8FF]/gu, '');
}

// Myers' shortest-edit-path algorithm. Returning only equal character pairs
// keeps the alignment independent of spelling differences between riwayat.
function matchingCharacterPairs(source, target) {
	const sourceLength = source.length;
	const targetLength = target.length;
	const max = sourceLength + targetLength;
	const offset = max + 1;
	const frontier = new Int32Array((2 * max) + 3);
	const trace = [];
	frontier[offset + 1] = 0;
	for (let distance = 0; distance <= max; distance += 1) {
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			const index = offset + diagonal;
			let sourceIndex;
			if (diagonal === -distance || (diagonal !== distance && frontier[index - 1] < frontier[index + 1]))
				sourceIndex = frontier[index + 1];
			else
				sourceIndex = frontier[index - 1] + 1;
			let targetIndex = sourceIndex - diagonal;
			while (sourceIndex < sourceLength && targetIndex < targetLength && source[sourceIndex] === target[targetIndex]) {
				sourceIndex += 1;
				targetIndex += 1;
			}
			frontier[index] = sourceIndex;
		}
		const snapshot = new Int32Array((2 * distance) + 1);
		for (let diagonal = -distance; diagonal <= distance; diagonal += 1)
			snapshot[diagonal + distance] = frontier[offset + diagonal];
		trace.push(snapshot);
		const finalDiagonal = sourceLength - targetLength;
		if (Math.abs(finalDiagonal) <= distance && (distance - finalDiagonal) % 2 === 0
				&& frontier[offset + finalDiagonal] >= sourceLength)
			return backtrackMatches(trace, sourceLength, targetLength, distance);
	}
	throw new Error('Unable to align ayah text');
}

function backtrackMatches(trace, sourceLength, targetLength, distance) {
	let sourceIndex = sourceLength;
	let targetIndex = targetLength;
	const pairs = [];
	for (let currentDistance = distance; currentDistance > 0; currentDistance -= 1) {
		const previous = trace[currentDistance - 1];
		const diagonal = sourceIndex - targetIndex;
		const previousValue = previousDiagonal => previous[previousDiagonal + currentDistance - 1];
		let previousDiagonal;
		if (diagonal === -currentDistance || (diagonal !== currentDistance
				&& previousValue(diagonal - 1) < previousValue(diagonal + 1)))
			previousDiagonal = diagonal + 1;
		else
			previousDiagonal = diagonal - 1;
		const previousSource = previousValue(previousDiagonal);
		const previousTarget = previousSource - previousDiagonal;
		while (sourceIndex > previousSource && targetIndex > previousTarget) {
			sourceIndex -= 1;
			targetIndex -= 1;
			pairs.push([sourceIndex, targetIndex]);
		}
		if (sourceIndex === previousSource)
			targetIndex -= 1;
		else
			sourceIndex -= 1;
	}
	while (sourceIndex > 0 && targetIndex > 0) {
		sourceIndex -= 1;
		targetIndex -= 1;
		pairs.push([sourceIndex, targetIndex]);
	}
	return pairs.reverse();
}

function surahCharacters(rows, surah) {
	const characters = [];
	const lengths = new Map();
	let text = '';
	for (const row of rows.filter(item => item.surah === surah)) {
		const normalized = normalize(row.text);
		if (normalized === '')
			throw new Error(`Ayah ${row.ref} has no alignable Arabic text`);
		lengths.set(row.ref, normalized.length);
		text += normalized;
		for (let index = 0; index < normalized.length; index += 1)
			characters.push(row.ref);
	}
	return { text, characters, lengths };
}

function targetCharacterData(ayahs, surah) {
	const characters = [];
	let text = '';
	for (const row of ayahs.filter(item => item.surah === surah && !(surah === 1 && item.ayah === 1))) {
		const normalized = normalize(row.text);
		text += normalized;
		for (let index = 0; index < normalized.length; index += 1)
			characters.push(row.ref);
	}
	return { text, characters };
}

function sourceWordCharacterData(words, surah) {
	const characters = [];
	let text = '';
	const surahWords = words.filter(item => item.surah === surah);
	for (const [wordIndex, row] of surahWords.entries()) {
		const normalized = normalize(row.text);
		text += normalized;
		for (let index = 0; index < normalized.length; index += 1)
			characters.push({ wordIndex, offset: index });
	}
	return { text, characters, words: surahWords };
}

function splitRawAtNormalizedOffset(text, normalizedOffset) {
	const characters = Array.from(text);
	let rawOffset = 0;
	for (let index = 1; index < characters.length; index += 1) {
		const length = normalize(characters.slice(0, index).join('')).length;
		if (length <= normalizedOffset)
			rawOffset = index;
		else
			break;
	}
	if (rawOffset < 1 || rawOffset >= characters.length)
		return null;
	return [characters.slice(0, rawOffset).join(''), characters.slice(rawOffset).join('')];
}

function assignedWordPieces(source, targetRefs, targetOrder) {
	const matches = Array.from(targetRefs.entries()).sort((a, b) => a[0] - b[0]);
	const counts = new Map();
	for (const [, ref] of matches)
		counts.set(ref, (counts.get(ref) || 0) + 1);
	const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || targetOrder.get(a[0]) - targetOrder.get(b[0]));
	const targets = Array.from(counts.keys()).sort((a, b) => targetOrder.get(a) - targetOrder.get(b));
	if (targets.length === 2 && targetOrder.get(targets[1]) === targetOrder.get(targets[0]) + 1
			&& counts.get(targets[0]) >= 2 && counts.get(targets[1]) >= 2) {
		const transition = matches.find(([offset, ref]) => ref === targets[1] && offset > 0);
		const split = transition && splitRawAtNormalizedOffset(source.text, transition[0]);
		if (split)
			return [Object.assign({}, source, { text: split[0], targetRef: targets[0] }),
				Object.assign({}, source, { text: split[1], targetRef: targets[1] })];
	}
	return [Object.assign({}, source, { targetRef: ranked[0] ? ranked[0][0] : null })];
}

function buildAlignedEdition(warshWords, uthmaniAyahs) {
	const targetOrder = new Map(uthmaniAyahs.map((row, index) => [row.ref, index]));
	const pieces = [];
	let splitWordCount = 0;
	for (let surah = 1; surah <= 114; surah += 1) {
		const source = sourceWordCharacterData(warshWords, surah);
		const target = targetCharacterData(uthmaniAyahs, surah);
		const matchesByWord = source.words.map(() => new Map());
		for (const [sourceIndex, targetIndex] of matchingCharacterPairs(source.text, target.text)) {
			const owner = source.characters[sourceIndex];
			matchesByWord[owner.wordIndex].set(owner.offset, target.characters[targetIndex]);
		}
		for (const [index, word] of source.words.entries()) {
			const wordPieces = assignedWordPieces(word, matchesByWord[index], targetOrder);
			if (wordPieces.length > 1)
				splitWordCount += 1;
			pieces.push(...wordPieces);
		}
	}
	for (let index = 0; index < pieces.length; index += 1) {
		if (pieces[index].targetRef)
			continue;
		let previous = index - 1;
		let next = index + 1;
		while (previous >= 0 && !pieces[previous].targetRef)
			previous -= 1;
		while (next < pieces.length && !pieces[next].targetRef)
			next += 1;
		if (normalize(pieces[index].text) === '' && next < pieces.length && pieces[next].surah === pieces[index].surah)
			pieces[index].targetRef = pieces[next].targetRef;
		else if (previous >= 0 && pieces[previous].surah === pieces[index].surah)
			pieces[index].targetRef = pieces[previous].targetRef;
		else if (next < pieces.length && pieces[next].surah === pieces[index].surah)
			pieces[index].targetRef = pieces[next].targetRef;
		else
			throw new Error(`Unable to assign Warsh word ${pieces[index].sourceRef} to an Uthmani ayah`);
	}
	const lexicalPieces = [];
	let foldedMarkerCount = 0;
	let pendingMarkers = [];
	for (const piece of pieces) {
		if (normalize(piece.text) === '') {
			pendingMarkers.push(piece.text);
			foldedMarkerCount += 1;
			continue;
		}
		if (pendingMarkers.length > 0) {
			piece.text = `${pendingMarkers.join(' ')} ${piece.text}`;
			pendingMarkers = [];
		}
		lexicalPieces.push(piece);
	}
	if (pendingMarkers.length > 0) {
		if (lexicalPieces.length < 1)
			throw new Error('Warsh word source contains markers without lexical words');
		lexicalPieces[lexicalPieces.length - 1].text += ` ${pendingMarkers.join(' ')}`;
	}

	const piecesByRef = new Map();
	for (const piece of lexicalPieces) {
		if (!piecesByRef.has(piece.targetRef))
			piecesByRef.set(piece.targetRef, []);
		piecesByRef.get(piece.targetRef).push(piece);
	}
	piecesByRef.set('1:1', WARSH_BASMALA.map((text, index) => ({
		text,
		sourceId: 49072 + index,
		sourceRef: `27:30:${5 + index}`,
		targetRef: '1:1'
	})));

	const ayahs = {};
	const words = {};
	let ayahId = 0;
	let wordId = 0;
	for (const target of uthmaniAyahs) {
		const ref = target.ref;
		const alignedWords = piecesByRef.get(ref) || [];
		if (alignedWords.length < 1)
			throw new Error(`Aligned Warsh edition has no words for Uthmani ayah ${ref}`);
		ayahId += 1;
		ayahs[ref] = {
			id: ayahId,
			verse_key: ref,
			surah: target.surah,
			ayah: target.ayah,
			text: alignedWords.map(row => row.text).join(' ')
		};
		alignedWords.forEach((row, index) => {
			wordId += 1;
			const location = `${ref}:${index + 1}`;
			words[location] = {
				id: wordId,
				surah: target.surah,
				ayah: target.ayah,
				word: index + 1,
				location,
				text: row.text,
				source_id: row.sourceId,
				source_location: row.sourceRef
			};
		});
	}
	return { ayahs, words, splitWordCount, foldedMarkerCount, insertedWordCount: WARSH_BASMALA.length };
}

function buildMapping(warshAyahs, uthmaniAyahs) {
	const warshSurahs = Array.from(new Set(warshAyahs.map(row => row.surah)));
	const uthmaniSurahs = Array.from(new Set(uthmaniAyahs.map(row => row.surah)));
	if (warshSurahs.join(',') !== uthmaniSurahs.join(','))
		throw new Error('Warsh and Uthmani sources do not contain the same surahs');
	const pairCounts = new Map();
	const lengths = new Map();
	for (const surah of warshSurahs) {
		const warsh = surahCharacters(warshAyahs, surah);
		const uthmani = surahCharacters(uthmaniAyahs, surah);
		for (const [ref, length] of warsh.lengths)
			lengths.set(`warsh:${ref}`, length);
		for (const [ref, length] of uthmani.lengths)
			lengths.set(`uthmani:${ref}`, length);
		for (const [warshIndex, uthmaniIndex] of matchingCharacterPairs(warsh.text, uthmani.text)) {
			const key = `${warsh.characters[warshIndex]}>${uthmani.characters[uthmaniIndex]}`;
			pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
		}
	}

	const warshToUthmani = Object.fromEntries(warshAyahs.map(row => [row.ref, []]));
	const uthmaniToWarsh = Object.fromEntries(uthmaniAyahs.map(row => [row.ref, []]));
	for (const [key, count] of pairCounts) {
		const [warshRef, uthmaniRef] = key.split('>');
		const shorterLength = Math.min(lengths.get(`warsh:${warshRef}`), lengths.get(`uthmani:${uthmaniRef}`));
		if (count / shorterLength < MIN_OVERLAP)
			continue;
		warshToUthmani[warshRef].push(uthmaniRef);
		uthmaniToWarsh[uthmaniRef].push(warshRef);
	}
	const unmappedWarsh = Object.entries(warshToUthmani).filter(([, refs]) => refs.length < 1).map(([ref]) => ref);
	if (unmappedWarsh.length > 0)
		throw new Error(`Unmapped Warsh ayahs: ${unmappedWarsh.join(', ')}`);
	return {
		schema_version: 1,
		warsh_ayah_count: warshAyahs.length,
		uthmani_ayah_count: uthmaniAyahs.length,
		mapping_row_count: Object.values(warshToUthmani).reduce((count, refs) => count + refs.length, 0),
		unmapped_uthmani: Object.entries(uthmaniToWarsh).filter(([, refs]) => refs.length < 1).map(([ref]) => ref),
		warsh_to_uthmani: warshToUthmani,
		uthmani_to_warsh: uthmaniToWarsh
	};
}

function run() {
	const warshFile = option('--warsh', DEFAULT_WARSH_FILE);
	const warshWordFile = option('--warsh-words', DEFAULT_WARSH_WORD_FILE);
	const uthmaniFile = option('--uthmani', DEFAULT_UTHMANI_FILE);
	const outputFile = option('--output', DEFAULT_OUTPUT_FILE);
	const alignedAyahFile = option('--aligned-ayahs', DEFAULT_ALIGNED_AYAH_FILE);
	const alignedWordFile = option('--aligned-words', DEFAULT_ALIGNED_WORD_FILE);
	const warshAyahs = loadAyahs(warshFile, 'Warsh ayah source');
	const uthmaniAyahs = loadAyahs(uthmaniFile, 'Uthmani ayah source');
	const warshWords = loadWords(warshWordFile, 'Warsh word source');
	const mapping = buildMapping(warshAyahs, uthmaniAyahs);
	const aligned = buildAlignedEdition(warshWords, uthmaniAyahs);
	fs.mkdirSync(path.dirname(outputFile), { recursive: true });
	fs.writeFileSync(outputFile, `${JSON.stringify(mapping, null, 2)}\n`);
	fs.writeFileSync(alignedAyahFile, `${JSON.stringify(aligned.ayahs)}\n`);
	fs.writeFileSync(alignedWordFile, `${JSON.stringify(aligned.words)}\n`);
	console.log(`Created ${mapping.mapping_row_count} Warsh-to-Uthmani mapping rows for ${mapping.warsh_ayah_count} Warsh ayahs.`);
	console.log(`Unmapped Uthmani ayahs: ${mapping.unmapped_uthmani.join(', ') || 'none'}.`);
	console.log(`Wrote ${outputFile}`);
	console.log(`Created aligned Warsh edition: ${Object.keys(aligned.ayahs).length} ayahs and ${Object.keys(aligned.words).length} words.`);
	console.log(`Split ${aligned.splitWordCount} joined source words, folded ${aligned.foldedMarkerCount} rub markers, and inserted ${aligned.insertedWordCount} Fatiha basmala words.`);
	console.log(`Wrote ${alignedAyahFile} and ${alignedWordFile}`);
}

if (require.main === module) {
	try {
		run();
	} catch (err) {
		console.error(err.stack || err.message || err);
		process.exitCode = 1;
	}
}

module.exports = { buildAlignedEdition, buildMapping, loadAyahs, loadWords, matchingCharacterPairs, normalize };
