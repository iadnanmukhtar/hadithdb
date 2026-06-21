// @ts-check
'use strict';

const debug = require('./Debug')('hadithdb:HadithKnowledge');
const axios = require('axios');
const crypto = require('crypto');
const createError = require('http-errors');
const Index = require('./Index');
const Utils = require('./Utils');

const INDEX = 'hadith_knowledge';
const DEFAULT_MODEL = 'gpt-5';
const MAX_SOURCE_TEXT = 6000;

class HadithKnowledge {

	static INDEX = INDEX;

	static async ensureTable() {
		await global.query(`
			CREATE TABLE IF NOT EXISTS hadiths_knowledge (
				hadithId INT NOT NULL PRIMARY KEY,
				ref VARCHAR(80) NOT NULL,
				book_alias VARCHAR(80) NOT NULL,
				source_hash CHAR(64) NOT NULL,
				knowledge_model VARCHAR(80) NOT NULL,
				summary_ar TEXT,
				topics_ar TEXT,
				teaching_ar TEXT,
				summary_en TEXT,
				topics_en TEXT,
				likely_questions_en MEDIUMTEXT,
				teaching_en TEXT,
				keywords_en TEXT,
				knowledge_json JSON,
				created DATETIME DEFAULT CURRENT_TIMESTAMP,
				lastmod DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				KEY ndx_book_alias (book_alias),
				KEY ndx_source_hash (source_hash)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
	}

	static async getHadithRows(options) {
		options = options || {};
		var where = ['vh.doctype = "hadith"', 'vh.body IS NOT NULL', 'TRIM(vh.body) != ""'];
		if (options.bookId !== undefined && options.bookId !== null)
			where.push(`vh.book_id = ${parseInt(options.bookId, 10)}`);
		if (options.fromId !== undefined && options.fromId !== null)
			where.push(`vh.hId >= ${parseInt(options.fromId, 10)}`);
		if (options.id !== undefined && options.id !== null)
			where.push(`vh.hId = ${parseInt(options.id, 10)}`);
		var limit = parseInt((options.limit || 100).toString(), 10);
		if (!Number.isInteger(limit) || limit < 1)
			limit = 100;
		return await global.query(`
			SELECT
				vh.*
			FROM v_hadiths vh
			LEFT JOIN hadiths_knowledge hk
				ON hk.hadithId = vh.hId
			WHERE ${where.join(' AND ')}
			${options.force ? '' : 'AND (hk.hadithId IS NULL OR hk.source_hash != SHA2(CONCAT(COALESCE(vh.title, ""), "\\n", COALESCE(vh.chain, ""), "\\n", COALESCE(vh.body, ""), "\\n", COALESCE(vh.footnote, "")), 256))'}
			ORDER BY vh.book_id, vh.ordinal
			LIMIT ${limit}`);
	}

	static sourceHash(row) {
		return crypto.createHash('sha256')
			.update([
				row.title || '',
				row.chain || '',
				row.body || '',
				row.footnote || ''
			].join('\n'))
			.digest('hex');
	}

	static async buildForHadith(row, options) {
		options = options || {};
		var model = getModelName(options.model);
		var knowledge = await generateKnowledge(row, model);
		var doc = buildKnowledgeDoc(row, knowledge, model);
		await HadithKnowledge.save(doc);
		await Index.updateBulk(INDEX, [doc], false);
		return doc;
	}

	static async syncForHadith(row, options) {
		options = options || {};
		if (!row)
			return { status: 'missing' };
		await HadithKnowledge.ensureTable();
		var hadithId = parseInt((row.hId || row.hadithId || row.id || '').toString(), 10);
		if (!Number.isInteger(hadithId) || hadithId < 1)
			return { status: 'invalid' };
		var sourceHash = HadithKnowledge.sourceHash(row);
		if (!options.force) {
			var existing = await global.query(`SELECT source_hash FROM hadiths_knowledge WHERE hadithId=${hadithId}`);
			if (existing.length > 0 && existing[0].source_hash === sourceHash)
				return { status: 'unchanged', hadithId: hadithId, ref: row.ref };
		}
		if (!getApiKey())
			return { status: 'no_api_key', hadithId: hadithId, ref: row.ref };
		var doc = await HadithKnowledge.buildForHadith(row, options);
		return { status: 'built', hadithId: hadithId, ref: row.ref, doc: doc };
	}

	static async syncForHadithId(hadithId, options) {
		hadithId = parseInt(hadithId, 10);
		if (!Number.isInteger(hadithId) || hadithId < 1)
			return { status: 'invalid' };
		var rows = await global.query(`SELECT * FROM v_hadiths WHERE hId=${hadithId}`);
		if (rows.length < 1)
			return { status: 'missing', hadithId: hadithId };
		return await HadithKnowledge.syncForHadith(rows[0], options);
	}

	static async syncForHadithRows(rows, options) {
		var results = [];
		for (var row of rows || []) {
			try {
				results.push(await HadithKnowledge.syncForHadith(row, options));
			} catch (err) {
				debug.error(`syncing chatbot knowledge for ${row.ref || row.hId || row.id || 'unknown'}: ${err.message}\n${err.stack || ''}`);
				results.push({
					status: 'error',
					hadithId: row.hId || row.hadithId || row.id,
					ref: row.ref,
					error: err.message
				});
			}
		}
		return results;
	}

	static async save(doc) {
		await HadithKnowledge.ensureTable();
		await global.query(`
			INSERT INTO hadiths_knowledge (
				hadithId, ref, book_alias, source_hash, knowledge_model,
				summary_ar, topics_ar, teaching_ar,
				summary_en, topics_en, likely_questions_en, teaching_en, keywords_en,
				knowledge_json
			) VALUES (
				${doc.hadithId},
				'${Utils.escSQL(doc.ref)}',
				'${Utils.escSQL(doc.book_alias)}',
				'${Utils.escSQL(doc.source_hash)}',
				'${Utils.escSQL(doc.knowledge_model)}',
				${sqlValue(doc.summary_ar)},
				${sqlValue(arrayText(doc.topics_ar))},
				${sqlValue(doc.teaching_ar)},
				${sqlValue(doc.summary_en)},
				${sqlValue(arrayText(doc.topics_en))},
				${sqlValue(arrayText(doc.likely_questions_en))},
				${sqlValue(doc.teaching_en)},
				${sqlValue(arrayText(doc.keywords_en))},
				CAST('${Utils.escSQL(JSON.stringify(doc.knowledge_json))}' AS JSON)
			)
			ON DUPLICATE KEY UPDATE
				ref = VALUES(ref),
				book_alias = VALUES(book_alias),
				source_hash = VALUES(source_hash),
				knowledge_model = VALUES(knowledge_model),
				summary_ar = VALUES(summary_ar),
				topics_ar = VALUES(topics_ar),
				teaching_ar = VALUES(teaching_ar),
				summary_en = VALUES(summary_en),
				topics_en = VALUES(topics_en),
				likely_questions_en = VALUES(likely_questions_en),
				teaching_en = VALUES(teaching_en),
				keywords_en = VALUES(keywords_en),
				knowledge_json = VALUES(knowledge_json)`);
	}

	static async indexStored(options) {
		options = options || {};
		var where = [];
		if (options.bookId !== undefined && options.bookId !== null)
			where.push(`vh.book_id = ${parseInt(options.bookId, 10)}`);
		if (options.fromId !== undefined && options.fromId !== null)
			where.push(`vh.hId >= ${parseInt(options.fromId, 10)}`);
		var limit = parseInt((options.limit || 1000).toString(), 10);
		if (!Number.isInteger(limit) || limit < 1)
			limit = 1000;
		var rows = await global.query(`
			SELECT vh.*, hk.*
			FROM hadiths_knowledge hk
			JOIN v_hadiths vh
				ON vh.hId = hk.hadithId
			${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
			ORDER BY vh.book_id, vh.ordinal
			LIMIT ${limit}`);
		var docs = rows.map(row => buildStoredKnowledgeDoc(row));
		if (docs.length > 0)
			await Index.updateBulk(INDEX, docs, false);
		return docs;
	}

	static async search(question, books, topK) {
		topK = parseInt((topK || 6).toString(), 10);
		if (!Number.isInteger(topK) || topK < 1)
			topK = 6;
		var query = buildKnowledgeQuery(question, books);
		var matches = await Index.docsFromQuery(INDEX, query, 0, Math.min(topK * 4, 40), '_score DESC, book_id ASC, ordinal ASC', true);
		var ids = [];
		var seen = new Set();
		for (var match of matches) {
			var id = parseInt((match.hadithId || match.hId || '').toString(), 10);
			if (!Number.isInteger(id) || seen.has(id))
				continue;
			seen.add(id);
			ids.push(id);
			if (ids.length >= topK)
				break;
		}
		if (ids.length < 1)
			return [];
		var items = await Index.docsFromIdArray('hadiths', ids, 0, ids.length);
		var byId = new Map(items.map(item => [parseInt((item.hId || item.id || '').toString(), 10), item]));
		return ids.map(id => byId.get(id)).filter(Boolean);
	}

}

module.exports = HadithKnowledge;

async function generateKnowledge(row, model) {
	var apiKey = getApiKey();
	if (!apiKey)
		throw createError(400, 'OPENAI_API_KEY or settings.openAI.key is required to build hadith knowledge');
	var input = [
		{
			role: 'developer',
			content: [
				'You create retrieval metadata for a hadith chatbot.',
				'Root every field in the Arabic hadith text only: Arabic title, isnad, matn, and Arabic footnote.',
				'Do not use the English translation as a source. English output is only for helping English conversations find the Arabic-rooted hadith.',
				'Do not issue legal rulings. Describe what the Arabic text directly supports.',
				'Return only valid JSON with these keys: summary_ar, topics_ar, teaching_ar, summary_en, topics_en, likely_questions_en, teaching_en, keywords_en.',
				'topics_ar, topics_en, likely_questions_en, and keywords_en must be arrays. Keep summaries concise.'
			].join(' ')
		},
		{
			role: 'user',
			content: buildArabicSourcePrompt(row)
		}
	];
	const t0 = Date.now();
	let response;
	try {
		debug(`knowledge OpenAI responses start model=${model} ref=${row.ref}`);
		response = await axios.post('https://api.openai.com/v1/responses', {
			model: model,
			input: input,
			text: {
				format: {
					type: 'json_object'
				}
			}
		}, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			timeout: 60000
		});
		const elapsedMs = Date.now() - t0;
		debug(`knowledge OpenAI responses done model=${model} ref=${row.ref} elapsedMs=${elapsedMs}`);
		debug.slow('OpenAI hadith knowledge', elapsedMs, `model=${model} ref=${row.ref}`);
	} catch (err) {
		debug.error(`knowledge OpenAI responses failed model=${model} ref=${row.ref} elapsedMs=${Date.now() - t0} status=${err.response?.status || 'n/a'}: ${err.response?.statusText || err.message}\n${err.stack || ''}`);
		throw err;
	}
	var text = response.data.output_text || extractOutputText(response.data);
	return normalizeKnowledge(JSON.parse(text));
}

function buildArabicSourcePrompt(row) {
	var lines = [
		`Reference: ${row.ref}`,
		`Book: ${row.book_name || row.book_shortName || row.book_alias || ''}`,
		`Grade: ${row.grade_grade || ''}`,
		'Arabic source fields:',
		row.title ? `Title: ${row.title}` : '',
		row.chain ? `Isnad: ${row.chain}` : '',
		row.body ? `Matn: ${row.body}` : '',
		row.footnote ? `Footnote: ${row.footnote}` : ''
	].filter(Boolean);
	return Utils.truncate(lines.join('\n'), MAX_SOURCE_TEXT, true);
}

function buildKnowledgeDoc(row, knowledge, model) {
	return Object.assign(baseDoc(row), {
		summary_ar: knowledge.summary_ar,
		topics_ar: knowledge.topics_ar,
		teaching_ar: knowledge.teaching_ar,
		summary_en: knowledge.summary_en,
		summary_en_search: knowledge.summary_en,
		topics_en: knowledge.topics_en,
		topics_en_search: arrayText(knowledge.topics_en),
		likely_questions_en: knowledge.likely_questions_en,
		likely_questions_en_search: arrayText(knowledge.likely_questions_en),
		teaching_en: knowledge.teaching_en,
		teaching_en_search: knowledge.teaching_en,
		keywords_en: knowledge.keywords_en,
		keywords_en_search: arrayText(knowledge.keywords_en),
		search_text_en: [
			knowledge.summary_en,
			arrayText(knowledge.topics_en),
			arrayText(knowledge.likely_questions_en),
			knowledge.teaching_en,
			arrayText(knowledge.keywords_en)
		].filter(Boolean).join(' '),
		source_hash: HadithKnowledge.sourceHash(row),
		knowledge_model: model,
		knowledge_updated: new Date().toISOString(),
		knowledge_json: knowledge
	});
}

function buildStoredKnowledgeDoc(row) {
	var json = parseJson(row.knowledge_json);
	return buildKnowledgeDoc(row, normalizeKnowledge(Object.assign({}, json, {
		summary_ar: row.summary_ar,
		topics_ar: splitStoredList(row.topics_ar),
		teaching_ar: row.teaching_ar,
		summary_en: row.summary_en,
		topics_en: splitStoredList(row.topics_en),
		likely_questions_en: splitStoredList(row.likely_questions_en),
		teaching_en: row.teaching_en,
		keywords_en: splitStoredList(row.keywords_en)
	})), row.knowledge_model);
}

function baseDoc(row) {
	return {
		doctype: 'hadith_knowledge',
		hId: row.hId || row.hadithId,
		hadithId: row.hId || row.hadithId,
		ref: row.ref,
		path: row.path,
		book_id: row.book_id,
		book_alias: row.book_alias,
		book_name_en: row.book_name_en,
		book_shortName_en: row.book_shortName_en,
		ordinal: row.ordinal,
		num: row.num,
		grade_grade_en: row.grade_grade_en,
		title: row.title,
		chain: row.chain,
		body: row.body,
		footnote: row.footnote
	};
}

function normalizeKnowledge(value) {
	value = value || {};
	return {
		summary_ar: Utils.trimToEmpty(value.summary_ar),
		topics_ar: asArray(value.topics_ar),
		teaching_ar: Utils.trimToEmpty(value.teaching_ar),
		summary_en: Utils.trimToEmpty(value.summary_en),
		topics_en: asArray(value.topics_en),
		likely_questions_en: asArray(value.likely_questions_en),
		teaching_en: Utils.trimToEmpty(value.teaching_en),
		keywords_en: asArray(value.keywords_en)
	};
}

function buildKnowledgeQuery(question, books) {
	var filters = [];
	var bookAliases = normalizeBookFilters(books);
	if (bookAliases.length > 0)
		filters.push({ terms: { book_alias: bookAliases } });
	var query = {
		bool: {
			should: [
				{ multi_match: { query: question, type: 'phrase', fields: ['likely_questions_en_search^8', 'summary_en_search^5', 'topics_en_search^5', 'teaching_en_search^4', 'keywords_en_search^3', 'search_text_en^3'] } },
				{ multi_match: { query: question, type: 'best_fields', operator: 'and', fields: ['likely_questions_en_search^6', 'summary_en_search^4', 'topics_en_search^4', 'teaching_en_search^3', 'keywords_en_search^3', 'search_text_en^2'] } },
				{ multi_match: { query: question, type: 'best_fields', operator: 'or', fields: ['likely_questions_en_search^4', 'summary_en_search^3', 'topics_en_search^3', 'teaching_en_search^2', 'keywords_en_search^2', 'search_text_en'] } }
			],
			minimum_should_match: 1
		}
	};
	if (filters.length > 0)
		query.bool.filter = filters;
	return query;
}

function normalizeBookFilters(books) {
	if (!books)
		return [];
	if (!Array.isArray(books))
		books = [books];
	var aliases = books.map(book => Utils.trimToEmpty(book)).filter(Boolean);
	if (aliases.indexOf('sahihayn') >= 0)
		aliases.push('bukhari', 'muslim');
	if (aliases.indexOf('kutubarbaah') >= 0)
		aliases.push('abudawud', 'tirmidhi', 'nasai', 'ibnmajah');
	if (aliases.indexOf('sixbooks') >= 0)
		aliases.push('bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah');
	return Array.from(new Set(aliases.filter(alias => alias !== 'sahihayn' && alias !== 'kutubarbaah' && alias !== 'sixbooks' && alias !== 'toc')));
}

function asArray(value) {
	if (Array.isArray(value))
		return value.map(item => Utils.trimToEmpty(item)).filter(Boolean).slice(0, 12);
	if (Utils.trimToEmpty(value) === '')
		return [];
	return Utils.trimToEmpty(value).split(/\s*[,؛;]\s*/).filter(Boolean).slice(0, 12);
}

function arrayText(value) {
	return asArray(value).join('\n');
}

function splitStoredList(value) {
	return Utils.trimToEmpty(value).split(/\n+/).map(item => item.trim()).filter(Boolean);
}

function sqlValue(value) {
	value = Utils.trimToEmpty(value);
	if (value === '')
		return 'NULL';
	return `'${Utils.escSQL(value)}'`;
}

function parseJson(value) {
	if (!value)
		return {};
	if (typeof value === 'object')
		return value;
	try {
		return JSON.parse(value);
	} catch (err) {
		return {};
	}
}

function getModelName(model) {
	return model || process.env.OPENAI_KNOWLEDGE_MODEL || process.env.OPENAI_MODEL || global.settings?.knowledge?.model || global.settings?.openAI?.model || DEFAULT_MODEL;
}

function getApiKey() {
	return process.env.OPENAI_API_KEY || global.settings?.openAI?.key || null;
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
