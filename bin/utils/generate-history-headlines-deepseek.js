#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const axios = require('axios');
const Utils = require('../../lib/Utils');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

const DEFAULT_CONCURRENCY = 4;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 6;
const EXCERPT_MAX = 600;
const ARABIC = /[\u0621-\u064A]/u;

const SYSTEM = `Treat this as classical Islamic history literature from Islamweb's Encyclopedia of the Prophetic Biography and Islamic History. For each supplied item, write a single high-impact, news-style English headline capturing the most significant event, figure, or development the item records. Write in the present tense as though reporting the event as news, yet stay factual and reverent: do not exaggerate, sensationalize, invent, or add facts absent from the source. Each headline must be exactly one line of 4 to 12 words, with no trailing period. Preserve historical names and distinctions; use conventional scholarly transliteration with diacritics (render ibn/bin as "b." and bint as "bt."). Keep ﷺ and ؓ exactly when present in the supplied English text. Return only strict JSON: {"headlines":[{"id":integer,"headline_en":string}]}. Return every supplied id exactly once, in the same order.`;

function messages(rows) {
	return [{
		role: 'system',
		content: SYSTEM
	}, {
		role: 'user',
		content: JSON.stringify(rows.map(row => ({
			id: row.id,
			title_ar: row.title,
			chapter: row.h1_title_en || row.h1_title || '',
			section: row.h2_title_en || row.h2_title || '',
			subsection: row.h3_title_en || row.h3_title || '',
			passage: String(row.body_en || '').slice(0, EXCERPT_MAX)
		})))
	}];
}

function validate(rows, headlines) {
	if (!Array.isArray(headlines) || headlines.length !== rows.length)
		throw new Error('Headline count mismatch');
	rows.forEach((row, index) => {
		const item = headlines[index];
		const headline = Utils.trimToEmpty(item && item.headline_en);
		const words = headline.split(/\s+/).filter(Boolean).length;
		if (Number(item && item.id) !== Number(row.id))
			throw new Error(`Headline id mismatch for ${row.id}`);
		if (!headline || ARABIC.test(headline) || /\[(?:AI|Machine)\]/i.test(headline))
			throw new Error(`Invalid headline for ${row.id}`);
		if (words < 2 || words > 15 || headline.length > 140)
			throw new Error(`Headline out of range for ${row.id} (${words} words)`);
	});
}

async function requestBatch(rows) {
	const settings = global.settings.deepSeek || {};
	if (!Utils.isTruthy(settings.key) || settings.model !== 'deepseek-v4-pro')
		throw new Error('settings.deepSeek.model must be deepseek-v4-pro with a configured key');
	const response = await axios.post('https://api.deepseek.com/chat/completions', {
		model: settings.model,
		messages: messages(rows),
		response_format: { type: 'json_object' },
		thinking: { type: 'disabled' },
		reasoning_effort: 'none'
	}, {
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
		timeout: 240000
	});
	const parsed = JSON.parse(Utils.trimToEmpty(response.data.choices[0].message.content).replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
	validate(rows, parsed.headlines);
	return parsed.headlines.map(item => ({
		id: Number(item.id),
		headline_en: Utils.normalizeArabicHonorifics(`✧ ${Utils.trimToEmpty(item.headline_en).replace(/^✧\s*/, '').replace(/[.!؟?؛;]+$/, '')}`)
	}));
}

async function generateBatch(rows, offset) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await requestBatch(rows);
		} catch (error) {
			lastError = error;
			console.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed at offset ${offset}: ${error.response?.data?.error?.message || error.message}`);
			if (attempt < MAX_ATTEMPTS)
				await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * (2 ** (attempt - 1)))));
		}
	}
	throw lastError;
}

function readOptions(argv) {
	const options = { replaceAll: false, limit: 0 };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--all') {
			options.replaceAll = true;
		} else if (arg === '--limit' && argv[i + 1]) {
			options.limit = Math.max(0, Number(argv[++i]) || 0);
		} else if (arg === '--dry-run') {
			options.dryRun = true;
		} else if (arg !== '' && !arg.startsWith('-')) {
			throw new Error(`Unexpected positional argument: ${arg}`);
		}
	}
	return options;
}

async function main() {
	const options = readOptions(process.argv.slice(2));
	const concurrency = Math.max(1, Number(process.env.HISTORY_HEADLINE_CONCURRENCY || DEFAULT_CONCURRENCY));
	const limitClause = options.limit > 0 ? ` LIMIT ${options.limit}` : '';
	const rows = await global.query(`
		SELECT h.id, h.num, CONCAT('history:', h.num) ref, h.title, h.body_en,
			t1.title h1_title, t1.title_en h1_title_en,
			t2.title h2_title, t2.title_en h2_title_en,
			t3.title h3_title, t3.title_en h3_title_en
		FROM hadiths h
		JOIN books b ON b.id=h.bookId AND b.alias='history' AND b.type='sirah'
		LEFT JOIN toc t1 ON t1.bookId=h.bookId AND t1.level=1 AND t1.h1=h.h1
		LEFT JOIN toc t2 ON t2.bookId=h.bookId AND t2.level=2 AND t2.h1=h.h1 AND t2.h2=h.h2
		LEFT JOIN toc t3 ON t3.bookId=h.bookId AND t3.level=3 AND t3.h1=h.h1 AND t3.h2=h.h2 AND t3.h3=h.h3
		WHERE ${options.replaceAll ? '1=1' : "(h.title_en IS NULL OR TRIM(h.title_en)='')"}
			AND h.body_en IS NOT NULL AND TRIM(h.body_en)<>''
		ORDER BY h.ordinal${limitClause}`);
	console.log(`Found ${rows.length} Islamweb history items to ${options.replaceAll ? 're-headline' : 'headline'}${options.limit > 0 ? ` (limited to ${options.limit})` : ''}.`);
	if (!rows.length)
		return;

	if (options.dryRun) {
		console.log('Dry run — sample prompt payload:');
		console.log(JSON.stringify(messages(rows.slice(0, Math.min(2, rows.length))), null, 2));
		return;
	}

	const batches = [];
	for (let offset = 0; offset < rows.length; offset += BATCH_SIZE)
		batches.push({ offset, rows: rows.slice(offset, offset + BATCH_SIZE) });

	const progress = { done: 0, total: rows.length };
	let next = 0;
	async function worker() {
		while (next < batches.length) {
			const index = next++;
			const headlines = await generateBatch(batches[index].rows, batches[index].offset);
			for (const headline of headlines) {
				const result = await global.query(`UPDATE hadiths SET title_en='${Utils.escSQL(headline.headline_en)}', temp_trans=1, lastmod=NOW() WHERE id=${Number(headline.id)}${options.replaceAll ? '' : " AND (title_en IS NULL OR TRIM(title_en)='')"}`);
				if (result.affectedRows !== 1)
					throw new Error(`Item ${headline.id} changed concurrently`);
				progress.done++;
			}
			console.log(`Headlined ${progress.done}/${progress.total}`);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

	await global.query("UPDATE books SET content_lastmod=NOW() WHERE alias='history'");
	await RuntimeRefresh.publish();
	await Promise.all([Utils.flushCacheContaining('history'), Utils.flushCacheContaining('book:history')]);
	console.log(`Completed ${progress.done} Islamweb history headlines. Rebuild the hadith index before serving them.`);
}

module.exports = { messages, validate, SYSTEM };

if (require.main === module) {
	main().then(() => process.exit(0)).catch(error => {
		console.error(error.response?.data || error.stack || error);
		process.exit(1);
	});
}
