#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const axios = require('axios');
const Utils = require('../../lib/Utils');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_CONCURRENCY = 4;
const MAX_ATTEMPTS = 5;
const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu;

function normalizedArabicTitle(title) {
	return Utils.trimToEmpty(title).replace(ARABIC_DIACRITICS, '');
}

function cachedTranslation(row) {
	if ((Number(row.level) === 2 || Number(row.level) === 3) && normalizedArabicTitle(row.title) === 'باب')
		return 'Section';
	return null;
}

function stripEnglishTocWrapper(title) {
	const marker = Utils.trimToEmpty(title).startsWith('✧') ? '✧ ' : '';
	let value = Utils.normalizeArabicHonorifics(Utils.trimToEmpty(title).replace(/^✧\s*/, ''));
	const wrapper = /^(?:(?:From\s+)?(?:the\s+)?Musnad|(?:the\s+)?Account|(?:the\s+)?Book|(?:the\s+)?Chapter|(?:the\s+)?Mention|(?:the\s+)?Narration|(?:the\s+)?Hadith)\s+(?:of|on|about|regarding|concerning)\s+/i;
	while (wrapper.test(value)) {
		value = value.replace(wrapper, '');
		value = value.replace(/^the\s+(?=[A-Z'\u02bf\u02be])/i, '');
	}
	return marker + value.replace(/[ \t]{2,}/g, ' ').trim();
}

function cleanSourceTitle(title) {
	const original = Utils.trimToEmpty(title);
	const cleaned = original
		.replace(/^(?:كِتَابُ|كِتَابٌ|كتاب|بَابُ|بَابٌ|باب|حديث|ذكر)\s*[:ؚ]?\s*/u, '');
	return cleaned || original;
}

function promptForBatch(rows) {
	const isHadith = rows.every(row => row.book_type === 'hadith');
	const context = isHadith
		? 'These are table-of-contents headings from hadith books. Interpret them in that context: they may be fiqh chapter topics, technical hadith terminology, or names and descriptions of the Companions and other narrators.'
		: 'These are table-of-contents headings from Islamic books.';
	return [
		{
			role: 'system',
			content: `Translate Arabic table-of-contents headings into concise, natural English. ${context}
Preserve the meaning, Islamic terminology, personal names, and honorifics accurately. Omit redundant heading wrappers such as "Musnad of", "Account of", "Book of", "Chapter on", "Mention of", "Narration of", and "Hadith of"; return only the substantive person or topic. Do not summarize, explain, add commentary, or invent numbering. Return only a JSON object whose keys are the supplied IDs and whose values are the English translations.`
		},
		{
			role: 'user',
			content: JSON.stringify(Object.fromEntries(rows.map(row => [String(row.id), cleanSourceTitle(row.title)])))
		}
	];
}

function parseTranslations(content, rows) {
	const parsed = JSON.parse(Utils.trimToEmpty(content).replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
	const result = new Map();
	for (const row of rows) {
		const value = Utils.trimToEmpty(parsed[String(row.id)]);
		if (!value)
			throw new Error(`DeepSeek omitted translation for toc id ${row.id}`);
		result.set(row.id, stripEnglishTocWrapper(Utils.replacePBUH(`✧ ${value.replace(/^"|"$/g, '')}`)));
	}
	return result;
}

function cacheDuplicateTitles(rows) {
	const cached = new Map();
	for (const row of rows) {
		const key = `${row.book_type}\u0000${row.level}\u0000${cleanSourceTitle(row.title)}`;
		if (!cached.has(key))
			cached.set(key, { ...row, duplicateIds: [] });
		cached.get(key).duplicateIds.push(row.id);
	}
	return [...cached.values()];
}

async function requestTranslations(rows) {
	const settings = global.settings.deepSeek || {};
	if (!Utils.isTruthy(settings.key) || !Utils.isTruthy(settings.model))
		throw new Error('settings.deepSeek.key and settings.deepSeek.model are required');
	const response = await axios.post('https://api.deepseek.com/chat/completions', {
		model: settings.model,
		messages: promptForBatch(rows),
		response_format: { type: 'json_object' },
		thinking: { type: 'disabled' },
		reasoning_effort: 'none'
	}, {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${settings.key}`
		},
		timeout: 120000
	});
	return parseTranslations(response.data.choices[0].message.content, rows);
}

async function saveTranslations(translations) {
	const clauses = [];
	const ids = [];
	for (const [id, title] of translations) {
		ids.push(Number(id));
		clauses.push(`WHEN ${Number(id)} THEN '${Utils.escSQL(title)}'`);
	}
	await global.query(`UPDATE toc SET title_en=CASE id ${clauses.join(' ')} END WHERE id IN (${ids.join(',')}) AND (title_en IS NULL OR TRIM(title_en)='')`);
}

async function translateBatch(rows, progress) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const representativeTranslations = await requestTranslations(rows);
			const translations = new Map();
			for (const row of rows)
				for (const id of row.duplicateIds || [row.id])
					translations.set(id, representativeTranslations.get(row.id));
			await saveTranslations(translations);
			progress.done += translations.size;
			console.log(`Translated ${progress.done}/${progress.total} (toc ids ${rows[0].id}-${rows[rows.length - 1].id})`);
			return;
		} catch (error) {
			lastError = error;
			console.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed for toc ids ${rows[0].id}-${rows[rows.length - 1].id}: ${error.response?.data?.error?.message || error.message}`);
			if (attempt < MAX_ATTEMPTS)
				await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
		}
	}
	throw lastError;
}

async function main() {
	const batchSize = Number(process.env.TOC_TRANSLATION_BATCH_SIZE || DEFAULT_BATCH_SIZE);
	const concurrency = Number(process.env.TOC_TRANSLATION_CONCURRENCY || DEFAULT_CONCURRENCY);
	const rows = await global.query(`
		SELECT t.id, t.level, t.title, b.type AS book_type, b.alias AS book_alias
		FROM toc t
		JOIN books b ON b.id=t.bookId
		WHERE b.type NOT IN ('quran', 'sirah')
			AND (t.title_en IS NULL OR TRIM(t.title_en)='')
			AND t.title IS NOT NULL AND TRIM(t.title)<>''
		ORDER BY b.type, b.ordinal, t.ordinal, t.id`);
	console.log(`Found ${rows.length} untranslated non-Quran, non-Sirah TOC headings.`);
	if (!rows.length)
		return;
	const knownTranslations = new Map();
	const modelRows = [];
	for (const row of rows) {
		const known = cachedTranslation(row);
		if (known)
			knownTranslations.set(row.id, known);
		else
			modelRows.push(row);
	}
	if (knownTranslations.size) {
		await saveTranslations(knownTranslations);
		console.log(`Applied ${knownTranslations.size} cached translations without a model request.`);
	}
	const uniqueRows = cacheDuplicateTitles(modelRows);
	console.log(`Using ${uniqueRows.length} normalized translation-cache entries for ${rows.length} headings.`);
	const batches = [];
	for (let i = 0; i < uniqueRows.length; i += batchSize)
		batches.push(uniqueRows.slice(i, i + batchSize));
	const progress = { done: knownTranslations.size, total: rows.length };
	let next = 0;
	async function worker() {
		while (next < batches.length) {
			const batch = batches[next++];
			await translateBatch(batch, progress);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
	const aliases = [...new Set(rows.map(row => row.book_alias))];
	await RuntimeRefresh.publish();
	await Promise.all(aliases.flatMap(alias => [
		Utils.flushCacheContaining(alias),
		Utils.flushCacheContaining(`book:${alias}`)
	]));
	console.log(`Flushed rendered TOC caches for ${aliases.length} affected books.`);
	console.log(`Completed ${progress.done} TOC translations. Rebuild the toc index with: node bin/buildSearchIndex.js --toc-only`);
}

module.exports = { cleanSourceTitle, normalizedArabicTitle, cachedTranslation, stripEnglishTocWrapper, promptForBatch, parseTranslations, cacheDuplicateTitles };

if (require.main === module) {
	main().then(() => process.exit(0)).catch(error => {
		console.error(error.response?.data || error.stack || error);
		process.exit(1);
	});
}
