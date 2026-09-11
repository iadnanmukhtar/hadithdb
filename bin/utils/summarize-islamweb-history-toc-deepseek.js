#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Utils = require('../../lib/Utils');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

const OUTPUT = path.resolve('data/islamweb-history-toc-summaries-en.json');
const CACHE = path.resolve('var/imports/islamweb-history-200-vocalized/toc-summaries-deepseek-v4-pro-v2');
const BATCH_SIZE = 8;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 5;
const ARABIC = /[\u0621-\u064A]/u;

function messages(rows) {
	return [{
		role: 'system',
		content: `Treat this as classical Islamic history literature. Write a very short English overview for each supplied table-of-contents heading from Islamweb's Encyclopedia of the Prophetic Biography and Islamic History, based only on its supplied source material. For H1 headings the source material is the descendant H2/H3 table of contents. For H2 headings with H3 children it is those child headings. For leaf H2 headings it is the English passage text belonging to that section.
Each overview must be exactly one concise factual sentence, normally 12-30 words and never more than 40 words. Describe the subjects covered beneath the parent; do not praise, interpret, authenticate reports, add facts, mention "this chapter/section", or merely repeat the parent title. Preserve historical names and distinctions. Use conventional scholarly transliteration with diacritics consistently. In personal names, render ibn/bin as "b." and bint as "bt.". Keep ﷺ and ؓ exactly when present in supplied English headings. Return only strict JSON: {"summaries":[{"id":integer,"intro_en":string}]}. Return every supplied id exactly once in the same order.`
	}, {
		role: 'user',
		content: JSON.stringify(rows.map(row => ({
			id: row.id,
			level: row.level,
			parent_title_en: row.title_en,
			parent_title_ar: row.title,
			source_material: row.descendants.length
				? row.descendants.map(child => ({ level: child.level, title_en: child.title_en, title_ar: child.title }))
				: row.passages.map(passage => passage.body_en)
		})))
	}];
}

function validate(rows, summaries) {
	if (!Array.isArray(summaries) || summaries.length !== rows.length)
		throw new Error('Summary count mismatch');
	rows.forEach((row, index) => {
		const summary = summaries[index];
		const intro = Utils.trimToEmpty(summary && summary.intro_en);
		const words = intro.split(/\s+/).filter(Boolean).length;
		if (Number(summary && summary.id) !== Number(row.id))
			throw new Error(`Summary id mismatch for ${row.id}`);
		if (!intro || ARABIC.test(intro) || words > 40 || /\[(?:AI|Machine)\]/i.test(intro))
			throw new Error(`Invalid summary for ${row.id}`);
		if (!/[.!?]$/.test(intro))
			throw new Error(`Summary is not a sentence for ${row.id}`);
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
	validate(rows, parsed.summaries);
	return parsed.summaries.map(summary => ({ id: Number(summary.id), intro_en: `✧ ${Utils.trimToEmpty(summary.intro_en).replace(/^✧\s*/, '')}` }));
}

async function generateBatch(rows, offset) {
	const filename = path.join(CACHE, `${offset}.json`);
	if (fs.existsSync(filename)) {
		const cached = JSON.parse(fs.readFileSync(filename));
		validate(rows, cached.map(item => ({ ...item, intro_en: Utils.trimToEmpty(item.intro_en).replace(/^✧\s*/, '') })));
		return cached;
	}
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const result = await requestBatch(rows);
			fs.writeFileSync(filename, `${JSON.stringify(result, null, 2)}\n`);
			return result;
		} catch (error) {
			lastError = error;
			console.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed at offset ${offset}: ${error.response?.data?.error?.message || error.message}`);
			if (attempt < MAX_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
		}
	}
	throw lastError;
}

async function loadTargets() {
	const rows = await global.query(`
		SELECT p.id,p.ordinal,p.level,p.h1,p.h2,p.title,p.title_en,p.intro_en
		FROM toc p JOIN books b ON b.id=p.bookId AND b.alias='history' AND b.type='sirah'
		WHERE p.level IN (1,2)
		ORDER BY p.ordinal`);
	const descendants = await global.query(`
		SELECT id,ordinal,level,h1,h2,title,title_en FROM toc
		WHERE bookId=(SELECT id FROM books WHERE alias='history') AND level IN (2,3)
		ORDER BY ordinal`);
	const passages = await global.query(`
		SELECT h1,h2,body_en FROM hadiths
		WHERE bookId=(SELECT id FROM books WHERE alias='history')
		ORDER BY ordinal`);
	return rows.map(row => ({
		...row,
		descendants: descendants.filter(child => Number(row.level) === 1
			? Number(child.h1) === Number(row.h1)
			: Number(child.level) === 3 && Number(child.h1) === Number(row.h1) && Number(child.h2) === Number(row.h2)),
		passages: passages.filter(passage => Number(passage.h1) === Number(row.h1) &&
			(Number(row.level) === 1 || Number(passage.h2) === Number(row.h2)))
	}));
}

async function main() {
	const rows = await loadTargets();
	const h1Count = rows.filter(row => Number(row.level) === 1).length;
	const h2Count = rows.filter(row => Number(row.level) === 2).length;
	const missingSource = rows.filter(row => !row.descendants.length && !row.passages.length);
	if (rows.length !== 825 || h1Count !== 5 || h2Count !== 820 || missingSource.length)
		throw new Error(`Unexpected summary target shape: total=${rows.length} h1=${h1Count} h2=${h2Count} missingSource=${missingSource.map(row => row.id).join(',')}`);
	if (process.argv.includes('--generate')) {
		fs.mkdirSync(CACHE, { recursive: true });
		const batches = [];
		for (let offset = 0; offset < rows.length; offset += BATCH_SIZE)
			batches.push({ offset, rows: rows.slice(offset, offset + BATCH_SIZE) });
		const results = new Array(batches.length);
		let next = 0;
		async function worker() {
			while (next < batches.length) {
				const index = next++;
				results[index] = await generateBatch(batches[index].rows, batches[index].offset);
				console.log(`Generated ${results.filter(Boolean).reduce((sum, batch) => sum + batch.length, 0)}/${rows.length}`);
			}
		}
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
		const summaries = results.flat();
		validate(rows, summaries.map(item => ({ ...item, intro_en: item.intro_en.replace(/^✧\s*/, '') })));
		fs.writeFileSync(OUTPUT, `${JSON.stringify({ alias: 'history', provider: 'deepseek', model: global.settings.deepSeek.model, summaries }, null, 2)}\n`);
		return;
	}
	const artifact = JSON.parse(fs.readFileSync(OUTPUT));
	const summaries = artifact.summaries;
	validate(rows, summaries.map(item => ({ ...item, intro_en: item.intro_en.replace(/^✧\s*/, '') })));
	const changes = rows.filter((row, index) => Utils.trimToEmpty(row.intro_en) !== summaries[index].intro_en);
	console.log(JSON.stringify({ targets: rows.length, h1: 5, h2: 820, changes: changes.length, apply: process.argv.includes('--apply') }));
	if (!process.argv.includes('--apply')) return;
	const cases = summaries.map(summary => `WHEN ${summary.id} THEN '${Utils.escSQL(summary.intro_en)}'`).join(' ');
	const ids = summaries.map(summary => summary.id).join(',');
	const result = await global.query(`UPDATE toc SET intro_en=CASE id ${cases} END WHERE id IN (${ids}) AND bookId=(SELECT id FROM books WHERE alias='history')`);
	if (result.affectedRows !== summaries.length)
		throw new Error(`Expected to update ${summaries.length} summaries, updated ${result.affectedRows}`);
	await global.query("UPDATE books SET content_lastmod=NOW() WHERE alias='history'");
	await RuntimeRefresh.publish();
	await Utils.flushBookDiskCache('history', { strict: true });
}

module.exports = { messages, validate };

if (require.main === module)
	main().then(() => process.exit()).catch(error => { console.error(error.response?.data || error.stack || error); process.exit(1); });
