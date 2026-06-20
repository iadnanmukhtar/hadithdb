// @ts-check
'use strict';

const axios = require('axios');
const debug = require('./Debug')('hadithdb:RAG');
const createError = require('http-errors');
const Arabic = require('./Arabic');
const Hadith = require('./Hadith');
const HadithKnowledge = require('./HadithKnowledge');
const Index = require('./Index');
const Search = require('./Search');
const Utils = require('./Utils');
const { Heading, Item } = require('./Model');

const DEFAULT_MODEL = 'gpt-5';
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 10;
const MAX_TEXT_LENGTH = 1200;

class Rag {

	/**
	 * @param {string} question
	 * @param {{ books?: string|string[], topK?: number, generate?: boolean }} [options]
	 */
	static async answer(question, options) {
		var result = await Rag.answerWithItems(question, options);
		delete result.items;
		return result;
	}

	/**
	 * @param {string} question
	 * @param {{ books?: string|string[], topK?: number, generate?: boolean }} [options]
	 */
	static async answerWithItems(question, options) {
		var t0 = new Date().getTime();
		question = Search.truncateQuery(question);
		if (!question)
			throw createError(400, 'Missing required question');
		options = options || {};
		var topK = normalizeTopK(options.topK);
		debug(`answer q="${debugText(question)}" topK=${topK} books=${debugBooks(options.books)} generate=${options.generate !== false}`);
		var items = await Rag.retrieveItems(question, {
			books: options.books,
			topK: topK
		});
		var lang = Arabic.isArabic(question) ? 'ar' : 'en';
		var retrieved = sourcesFromItems(items, lang);
		var result = {
			question: question,
			answer: null,
			model: null,
			generated: false,
			source: items.source || 'elasticsearch',
			retrieval: retrieved,
			items: items
		};
		if (options.generate === false || !getApiKey()) {
			debug(`answer using fallback retrieved=${retrieved.length} apiKey=${getApiKey() ? 'yes' : 'no'}`);
			result.answer = fallbackAnswer(retrieved);
			debug(`answer complete generated=false elapsed=${elapsed(t0)}s`);
			return result;
		}
		result.model = getModelName();
		result.answer = await generateAnswer(question, retrieved, result.model);
		result.generated = true;
		debug(`answer complete generated=true model=${result.model} retrieved=${retrieved.length} elapsed=${elapsed(t0)}s`);
		return result;
	}

	/**
	 * @param {string} question
	 * @param {{ books?: string|string[], topK?: number }} [options]
	 */
	static async retrieve(question, options) {
		question = Search.truncateQuery(question);
		if (!question)
			throw createError(400, 'Missing required question');
		options = options || {};
		var lang = Arabic.isArabic(question) ? 'ar' : 'en';
		var items = await Rag.retrieveItems(question, options);
		return sourcesFromItems(items, lang);
	}

	/**
	 * @param {string} question
	 * @param {{ books?: string|string[], topK?: number }} [options]
	 */
	static async retrieveItems(question, options) {
		var t0 = new Date().getTime();
		question = Search.truncateQuery(question);
		if (!question)
			throw createError(400, 'Missing required question');
		options = options || {};
		var topK = normalizeTopK(options.topK);
		var lang = Arabic.isArabic(question) ? 'ar' : 'en';
		debug(`retrieve q="${debugText(question)}" lang=${lang} topK=${topK} books=${debugBooks(options.books)}`);
		try {
			var results = await searchKnowledge(question, options.books, topK);
			var source = 'knowledge';
			if (results.length < 1) {
				results = await Search.a_searchText(question, options.books, 0);
				source = 'elasticsearch';
			}
			var items = results.slice(0, topK).map(stripHighlights);
			items.source = source;
			debug(`retrieve complete source=${source} hits=${results.length} returned=${items.length} refs=${items.map(item => item.ref).join(',')} elapsed=${elapsed(t0)}s`);
			return items;
		} catch (err) {
		debug.error(`retrieve failed q="${debugText(question)}" error=${err.message}\n${err.stack || ''}`);
			throw err;
		}
	}

	/**
	 * @param {{ id?: string|number, ref?: string, books?: string|string[], topK?: number, includeLinked?: boolean }} options
	 */
	static async similar(options) {
		var result = await Rag.similarItems(options);
		return {
			target: sourceFromItem(result.target, 0, 'en'),
			query: result.query,
			method: result.method,
			similar: sourcesFromItems(result.similar, Arabic.isArabic(result.query) ? 'ar' : 'en')
		};
	}

	/**
	 * @param {{ id?: string|number, ref?: string, books?: string|string[], topK?: number, includeLinked?: boolean }} options
	 */
	static async similarItems(options) {
		var t0 = new Date().getTime();
		options = options || {};
		var item = await findRecord(options);
		var topK = normalizeTopK(options.topK);
		var query = buildSimilarQuery(item);
		debug(`similar target=${item.ref || item.hId || item.id} topK=${topK} books=${debugBooks(options.books)} includeLinked=${options.includeLinked !== false} query="${debugText(query)}"`);
		var ragMatches = await Search.a_searchText(query, options.books, 0);
		var similar = [];
		var seen = new Set([recordKey(item)]);
		for (var i = 0; i < ragMatches.length && similar.length < topK; i++) {
			var candidate = ragMatches[i];
			var candidateId = recordKey(candidate);
			if (seen.has(candidateId))
				continue;
			seen.add(candidateId);
			candidate = stripHighlights(candidate);
			candidate.matchType = 'rag';
			candidate.score = candidate._score;
			similar.push(candidate);
		}
		var ragCount = similar.length;
		var linkedCount = 0;
		if (options.includeLinked !== false && similar.length < topK && item.doctype !== 'toc') {
			var linked = await Hadith.a_dbGetSimilarCandidates(item);
			debug(`similar linked fallback candidates=${linked.length} current=${similar.length}`);
			for (i = 0; i < linked.length && similar.length < topK; i++) {
				candidate = linked[i];
				candidateId = recordKey(candidate);
				if (seen.has(candidateId))
					continue;
				seen.add(candidateId);
				candidate.matchType = 'linked';
				similar.push(candidate);
				linkedCount++;
			}
		}
		debug(`similar complete target=${item.ref || item.hId || item.id} ragCandidates=${ragMatches.length} ragReturned=${ragCount} linkedReturned=${linkedCount} total=${similar.length} refs=${similar.map(sim => `${sim.matchType}:${sim.ref}`).join(',')} elapsed=${elapsed(t0)}s`);
		return {
			target: item,
			query: query,
			method: 'rag',
			similar: similar
		};
	}

}

async function searchKnowledge(question, books, topK) {
	try {
		return await HadithKnowledge.search(question, books, topK);
	} catch (err) {
		debug.error(`knowledge search unavailable q="${debugText(question)}" error=${err.message}\n${err.stack || ''}`);
		return [];
	}
}

module.exports = Rag;

function normalizeTopK(topK) {
	topK = parseInt((topK || DEFAULT_TOP_K).toString(), 10);
	if (!Number.isFinite(topK) || topK < 1)
		return DEFAULT_TOP_K;
	return Math.min(topK, MAX_TOP_K);
}

function getModelName() {
	return process.env.OPENAI_MODEL || global.settings?.rag?.model || global.settings?.openAI?.model || DEFAULT_MODEL;
}

function getApiKey() {
	return process.env.OPENAI_API_KEY || global.settings?.openAI?.key || null;
}

function buildSimilarQuery(item) {
	var fields;
	if (item.doctype === 'toc') {
		fields = [
			headingTitle(item, ''),
			headingIntro(item, '')
		].map(cleanText).filter(Boolean);
		if (fields.length < 1) {
			fields = [
				headingTitle(item, '_en'),
				headingIntro(item, '_en')
			].map(cleanText).filter(Boolean);
		}
		} else {
			fields = [
				item.title,
				item.body,
				item.footnote
			].map(cleanText).filter(Boolean);
		if (fields.length < 1) {
			fields = [
				item.title_en,
				item.body_en,
				item.footnote_en
			].map(cleanText).filter(Boolean);
		}
	}
	if (fields.length < 1)
		throw createError(400, 'Record has no searchable text');
	var query = truncate(fields.join(' '), 900);
	debug(`similar query built target=${item.ref || item.hId || item.id} lang=${Arabic.isArabic(query) ? 'ar' : 'en'} fields=${fields.length} length=${query.length}`);
	return query;
}

async function findRecord(options) {
	if (options.doctype === 'toc' || options.tocId)
		return await findHeading(options);
	return await findItem(options);
}

async function findHeading(options) {
	var rows;
	if (options.tocId !== undefined && options.tocId !== null && `${options.tocId}`.trim() !== '') {
		var id = parseInt(`${options.tocId}`, 10);
		if (!Number.isInteger(id) || id < 1)
			throw createError(400, 'Invalid heading id');
		debug(`findHeading by id=${id}`);
		try {
			var heading = new Heading(await Index.docFromId('toc', id));
			debug(`findHeading found by doc id=${id} path=${heading.path}`);
			return heading;
		} catch (err) {
			if (err.status !== 404 && err.statusCode !== 404)
				throw err;
			debug(`findHeading doc id=${id} not found, falling back to hId lookup`);
		}
		rows = await Index.docsFromKeyValue('toc', { hId: id }, 0, 1);
	} else if (options.ref) {
		var ref = Search.truncateQuery(options.ref);
		debug(`findHeading by path=${ref}`);
		rows = await Index.docsFromKeyValue('toc', { path: ref }, 0, 1);
	} else {
		throw createError(400, 'Missing heading id or ref');
	}
	if (!rows || rows.length < 1)
		throw createError(404, 'Heading not found');
	var heading = new Heading(rows[0]);
	debug(`findHeading found path=${heading.path} id=${heading.tId || heading.id}`);
	return heading;
}

async function findItem(options) {
	var rows;
	if (options.id !== undefined && options.id !== null && `${options.id}`.trim() !== '') {
		var id = parseInt(`${options.id}`, 10);
		if (!Number.isInteger(id) || id < 1)
			throw createError(400, 'Invalid hadith id');
		debug(`findItem by id=${id}`);
		try {
			var item = new Item(await Index.docFromId('hadiths', id));
			debug(`findItem found by doc id=${id} ref=${item.ref}`);
			return item;
		} catch (err) {
			if (err.status !== 404 && err.statusCode !== 404)
				throw err;
			debug(`findItem doc id=${id} not found, falling back to hId lookup`);
		}
		rows = await Index.docsFromKeyValue('hadiths', { hId: id }, 0, 1);
	} else if (options.ref) {
		var ref = Search.truncateQuery(options.ref);
		debug(`findItem by ref=${ref}`);
		rows = await Index.docsFromKeyValue('hadiths', { ref: ref }, 0, 1);
	} else {
		throw createError(400, 'Missing hadith id or ref');
	}
	if (!rows || rows.length < 1)
		throw createError(404, 'Hadith not found');
	var item = new Item(rows[0]);
	debug(`findItem found ref=${item.ref} id=${item.hId || item.id}`);
	return item;
}

function sourceFromItem(item, citationId, lang) {
	var bookAlias = item.book_alias || item.book?.alias || item.en?.book_shortName || '';
	var path = item.path || (bookAlias && item.num ? `${bookAlias}:${item.num}` : '');
	var ref = item.ref || (bookAlias && item.num ? `${bookAlias}:${item.num}` : path);
	var url = buildSourceUrl(item, bookAlias, ref, path);
	var title = cleanText(item.title_en || item.title || item.en?.title || item.ar?.title || '');
	var source = {
		citationId: citationId,
		id: item.hId || item.id,
		ref: ref,
		path: path,
		url: url,
		book: cleanText(item.book_name_en || item.book_name || item.en?.book_name || item.ar?.book_name || bookAlias),
		bookAlias: bookAlias,
		number: item.num,
		grade: cleanText(item.grade_grade_en || item.grade_grade || ''),
		title: title,
		chain_en: cleanText(item.chain_en || ''),
		body_en: cleanText(item.body_en || ''),
		footnote_en: cleanText(item.footnote_en || ''),
		chain: cleanText(item.chain || ''),
		body: cleanText(item.body || ''),
		footnote: cleanText(item.footnote || ''),
		matchType: item.matchType,
		rating: item.rating,
		score: item.score || item._score
	};
	source.context = buildContext(source, lang);
	return source;
}

function buildSourceUrl(item, bookAlias, ref, path) {
	if (item.doctype === 'toc')
		return path ? `/${path}` : null;
	if (bookAlias && item.num)
		return `/${bookAlias}:${item.num}`;
	if (ref && ref.includes(':'))
		return `/${ref}`;
	return path ? `/${path}` : null;
}

function headingTitle(item, suffix) {
	return item.title || item[`title${suffix}`] || item[`h${item.level}_title${suffix}`] || '';
}

function headingIntro(item, suffix) {
	return item.intro || item[`intro${suffix}`] || item[`h${item.level}_intro${suffix}`] || '';
}

function recordKey(item) {
	return `${item.doctype || 'hadith'}:${item.hId || item.tId || item.id || item.ref || item.path}`;
}

function sourcesFromItems(items, lang) {
	return items.map((item, index) => sourceFromItem(item, index + 1, lang));
}

function stripHighlights(item) {
	var keys = [
		'title_en', 'title',
		'part_en', 'part',
		'chain_en', 'chain',
		'body_en', 'body',
		'footnote_en', 'footnote',
		'note_en', 'note',
		'h1_title_en', 'h1_title',
		'h2_title_en', 'h2_title',
		'h3_title_en', 'h3_title',
		'h1_intro_en', 'h1_intro',
		'h2_intro_en', 'h2_intro',
		'h3_intro_en', 'h3_intro'
	];
	for (var key of keys) {
		if (typeof item[key] === 'string')
			item[key] = stripHighlightText(item[key]);
	}
	stripHighlightObject(item.en);
	stripHighlightObject(item.ar);
	return item;
}

function stripHighlightObject(obj) {
	if (!obj)
		return;
	for (var key in obj) {
		if (typeof obj[key] === 'string')
			obj[key] = stripHighlightText(obj[key]);
	}
}

function stripHighlightText(text) {
	return text.replace(/[❬❭]/g, '');
}

function buildContext(source, lang) {
	var lines = [
		`[${source.ref}] ${source.book}${source.number ? ` ${source.number}` : ''}${source.grade ? ` (${source.grade})` : ''}`,
		source.title ? `Title: ${source.title}` : ''
	];
	if (lang === 'ar') {
		lines.push(source.chain ? `Chain: ${source.chain}` : '');
		lines.push(source.body ? `Text: ${source.body}` : '');
		lines.push(source.footnote ? `Footnote: ${source.footnote}` : '');
		if (source.body_en)
			lines.push(`English: ${source.body_en}`);
	} else {
		lines.push(source.chain_en ? `Chain: ${source.chain_en}` : '');
		lines.push(source.body_en ? `Text: ${source.body_en}` : '');
		lines.push(source.footnote_en ? `Footnote: ${source.footnote_en}` : '');
		if (source.body)
			lines.push(`Arabic: ${source.body}`);
	}
	return truncate(lines.filter(Boolean).join('\n'), MAX_TEXT_LENGTH);
}

function cleanText(value) {
	return Utils.trimToEmpty(value)
		.replace(/[❬❭]/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function truncate(value, maxLength) {
	if (!value || value.length <= maxLength)
		return value;
	return `${value.substring(0, maxLength - 1).trim()}…`;
}

function fallbackAnswer(sources) {
	if (sources.length < 1)
		return 'No matching hadith sources were found in the local index.';
	return 'Generation is disabled because no OpenAI API key is configured. I found these HadithDB sources: ' +
		sources.map(source => `${citationLink(source)} ${source.book}${source.number ? ` ${source.number}` : ''}`).join('; ');
}

async function generateAnswer(question, sources, model) {
	if (sources.length < 1)
		return 'No matching hadith sources were found in the local index.';
	var t0 = new Date().getTime();
	debug(`generate start model=${model} sources=${sources.length} q="${debugText(question)}"`);
	var input = [
		{
			role: 'developer',
			content: [
				'You are a HadithDB chatbot. Answer questions about hadith using only the provided HadithDB sources.',
				'Write the explanatory answer in English, even if the user asks in another language.',
				'When quoting or directly referencing hadith text, preserve the hadith wording in its source language and identify whether it is Arabic text or an English translation.',
				'Cite every factual claim with bracketed HadithDB references exactly as provided, such as [bukhari:1] or [muslim:1907a].',
				'If the sources do not answer the question, say that the database results do not establish an answer.',
				'Do not issue legal rulings or religious verdicts. For fiqh conclusions, advise consulting a qualified scholar.',
				'Markdown is allowed. Keep the answer concise and distinguish translation/summary from the hadith text.'
			].join(' ')
		},
		{
			role: 'user',
			content: `Question: ${question}\n\nHadithDB sources:\n${sources.map(source => source.context).join('\n\n')}`
		}
	];
	try {
		var response = await axios.post('https://api.openai.com/v1/responses', {
			model: model,
			input: input
		}, {
			headers: {
				Authorization: `Bearer ${getApiKey()}`,
				'Content-Type': 'application/json'
			},
			timeout: 60000
		});
		var text = linkCitationReferences(normalizeMarkdownAnswer(response.data.output_text || extractOutputText(response.data) || ''), sources);
		debug(`generate complete model=${model} answerLength=${text.length} elapsed=${elapsed(t0)}s`);
		return text;
	} catch (err) {
		debug.error(`generate failed model=${model} elapsed=${elapsed(t0)}s error=${err.message}\n${err.stack || ''}`);
		if (err.response) {
			var message = err.response.data?.error?.message || err.response.statusText;
			throw createError(err.response.status >= 500 ? 502 : err.response.status, `OpenAI generation failed: ${message}`);
		}
		throw createError(503, `OpenAI generation failed: ${err.message}`);
	}
}

function extractOutputText(data) {
	var chunks = [];
	for (var item of data.output || []) {
		for (var content of item.content || []) {
			if (content.text)
				chunks.push(content.text);
		}
	}
	return chunks.join('\n').trim();
}

function normalizeMarkdownAnswer(text) {
	return Utils.trimToEmpty(text)
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n');
}

function linkCitationReferences(text, sources) {
	var sourceById = new Map(sources.map(source => [`${source.citationId}`, source]));
	var sourceByRef = new Map(sources.map(source => [source.ref, source]));
	return text
		.replace(/(?<!\[)\[(\d+)\](?![\]\(])/g, function (match, citationId) {
			var source = sourceById.get(`${citationId}`);
			if (!source || !source.url)
				return match;
			return citationLink(source);
		})
		.replace(/(?<!\[)\[([a-z0-9-]+:[^\]\s]+)\](?![\]\(])/gi, function (match, ref) {
			var source = sourceByRef.get(ref);
			if (!source || !source.url)
				return match;
			return citationLink(source);
		});
}

function citationLink(source) {
	if (!source.url)
		return `[${source.ref}]`;
	return `[[${source.ref}]](${source.url})`;
}

function debugBooks(books) {
	if (!books)
		return 'all';
	if (Array.isArray(books))
		return books.length > 0 ? books.join(',') : 'all';
	return `${books}`;
}

function debugText(text) {
	return Utils.truncate(Utils.trimToEmpty(text).replace(/\s+/g, ' '), 160, true);
}

function elapsed(t0) {
	return ((new Date().getTime() - t0) / 1000).toFixed(3);
}
