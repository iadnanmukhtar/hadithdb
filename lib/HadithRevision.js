'use strict';

const debug = require('./Debug')('hadithdb:HadithRevision');
const axios = require('axios');
const mysql = require('mysql');
const Utils = require('./Utils');
const Index = require('./Index');
const HadithKnowledge = require('./HadithKnowledge');
const { Item, Heading } = require('./Model');

const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670]/g;
const MIN_DIACRITICS_TO_VALIDATE = 10;
const MIN_DIACRITIC_PRESERVATION_RATIO = 0.9;
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'hf.co/goodasdgood/SILMA-9B-Instruct-v1.0-IQ4_NL-GGUF:latest';

async function reviseHadithById(hadithId, options) {
	var item = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${parseInt(hadithId, 10)}`))[0];
	if (!item)
		throw new Error(`Hadith not found: ${hadithId}`);
	return reviseHadith(item, options);
}

async function reviseHadith(item, options) {
	options = options || {};
	var result = await requestRevision(item, options);

	var chain = normalizeArabic(result.chain);
	var body = normalizeArabic(result.body);
	var footnote = normalizeArabic(result.footnote);
	var chain_en = normalizeChainEnglish(result.chain_en);
	var body_en = normalizeHadithEnglish(result.body_en, true);
	var footnote_en = Utils.isTruthy(footnote) ? normalizeHadithEnglish(result.footnote_en, true) : '';

	if (Utils.isFalsey(chain) || Utils.isFalsey(body) || Utils.isFalsey(body_en))
		throw new Error(`Model returned incomplete data for ${item.ref}`);
	if (Utils.isTruthy(footnote) && Utils.isFalsey(footnote_en))
		throw new Error(`Model returned incomplete footnote translation for ${item.ref}`);
	assertArabicDiacriticsPreserved(item, chain, body, footnote);

	var updates = [
		`chain=${sqlValue(chain)}`,
		`body=${sqlValue(body)}`,
		`footnote=${sqlValue(footnote)}`,
		`chain_en=${sqlValue(chain_en)}`,
		`body_en=${sqlValue(body_en)}`,
		`footnote_en=${sqlValue(footnote_en)}`,
		`temp_trans=1`,
		`lastfixed=CURRENT_TIMESTAMP()`
	];

	if (options.userId)
		updates.push(`lastmod_user=${sqlValue(options.userId)}`);

	await global.query(`UPDATE hadiths SET ${updates.join(', ')} WHERE id=${item.hId}`);

	var refreshed = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${item.hId}`))[0];
	runPostRevisionMaintenance(refreshed, options);

	return {
		item: refreshed,
		changed: {
			chain: chain,
			body: body,
			footnote: footnote,
			chain_en: chain_en,
			body_en: body_en,
			footnote_en: footnote_en
		}
	};
}

function runPostRevisionMaintenance(item, options) {
	options = options || {};
	(async () => {
		await safeBackground(`flushing cache for ${item.ref}`, async () => {
			await Utils.flushCacheContaining(`${item.book_alias}:${item.num}`);
		});
		await safeBackground(`reindexing hadith ${item.ref}`, async () => {
			await Index.update(Item.INDEX, item);
		});
		await safeBackground(`reindexing headings for ${item.ref}`, async () => {
			await reindexHeadings(item);
		});
		if (options.syncKnowledge !== false) {
			await safeBackground(`syncing chatbot knowledge for ${item.ref}`, async () => {
				await HadithKnowledge.syncForHadith(item, { force: true });
			});
		}
	})().catch((err) => {
		debug.error(`post-revision maintenance for ${item.ref}: ${err.message}\n${err.stack || ''}`);
	});
}

async function safeBackground(label, fn) {
	try {
		await fn();
	} catch (err) {
		debug.error(`${label}: ${err.message}\n${err.stack || ''}`);
	}
}

async function requestRevision(item, options) {
	options = options || {};
	if (revisionProvider(options) === 'ollama')
		return requestOllamaRevision(item, options);
	return requestOpenAIRevision(item, options);
}

async function requestOpenAIRevision(item, options) {
	options = options || {};
	var data = buildRevisionRequestData(item, {
		model: options.model || Utils.getOpenAIModel()
	});

	const t0 = Date.now();
	let res;
	try {
		debug(`revision OpenAI chat start model=${data.model} ref=${item.ref}`);
		res = await axios.post('https://api.openai.com/v1/chat/completions', data, {
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${global.settings.openAI.key}`
			}
		});
		const elapsedMs = Date.now() - t0;
		debug(`revision OpenAI chat done model=${data.model} ref=${item.ref} elapsedMs=${elapsedMs}`);
		debug.slow('OpenAI hadith revision', elapsedMs, `model=${data.model} ref=${item.ref}`);
	} catch (err) {
		debug.error(`revision OpenAI chat failed model=${data.model} ref=${item.ref} elapsedMs=${Date.now() - t0} status=${err.response?.status || 'n/a'}: ${err.response?.statusText || err.message}\n${err.stack || ''}`);
		throw err;
	}

	var content = Utils.trimToEmpty(res.data.choices?.[0]?.message?.content);
	if (Utils.isFalsey(content))
		throw new Error('Empty OpenAI response');

	return parseJson(content);
}

async function requestOllamaRevision(item, options) {
	options = options || {};
	var model = options.model || process.env.OLLAMA_HADITH_REVISION_MODEL || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
	var baseUrl = trimTrailingSlash(options.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL);
	var timeout = options.timeout || Number(process.env.OLLAMA_TIMEOUT_MS) || 300000;
	var data = {
		model: model,
		messages: buildRevisionMessages(item),
		format: 'json',
		stream: false
	};

	const t0 = Date.now();
	let res;
	try {
		debug(`revision Ollama chat start model=${model} ref=${item.ref}`);
		res = await axios.post(`${baseUrl}/api/chat`, data, { timeout: timeout });
		const elapsedMs = Date.now() - t0;
		debug(`revision Ollama chat done model=${model} ref=${item.ref} elapsedMs=${elapsedMs}`);
		debug.slow('Ollama hadith revision', elapsedMs, `model=${model} ref=${item.ref}`);
	} catch (err) {
		debug.error(`revision Ollama chat failed model=${model} ref=${item.ref} elapsedMs=${Date.now() - t0} status=${err.response?.status || 'n/a'}: ${err.response?.statusText || err.message}\n${err.stack || ''}`);
		throw err;
	}

	var content = Utils.trimToEmpty(res.data?.message?.content);
	if (Utils.isFalsey(content))
		throw new Error('Empty Ollama response');

	return parseJson(content);
}

function revisionProvider(options) {
	options = options || {};
	var provider = Utils.trimToEmpty(options.provider || process.env.HADITH_REVISION_PROVIDER || '');
	return provider.toLowerCase() === 'ollama' ? 'ollama' : 'openai';
}

function buildRevisionRequestData(item, options) {
	options = options || {};
	return {
		model: options.model || Utils.getOpenAIModel(),
		reasoning_effort: options.reasoning_effort || 'medium',
		messages: buildRevisionMessages(item),
		response_format: revisionResponseFormat()
	};
}

function buildRevisionMessages(item) {
	return [
			{
				role: 'system',
				content:
`You are separating and translating a hadith record.
Return only strict JSON matching the schema.
Preserve the Arabic source wording exactly.
Only move Arabic text among chain, body, and footnote when the split is clearly wrong.
The chain is only the narrator chain.
The body is only the hadith text.
The footnote is only explanatory note text.
If the split is not clearly wrong, keep the Arabic fields unchanged.
Translate the final chain, body, and footnote into English.
If there is no footnote, return empty strings for footnote and footnote_en.
Do not correct, polish, punctuate, summarize, paraphrase, format, or add anything else.`
			},
			{
				role: 'user',
				content:
`Separate and translate this hadith record.

arabic_chain:
${Utils.trimToEmpty(item.chain)}

arabic_body:
${Utils.trimToEmpty(item.body)}

arabic_footnote:
${Utils.trimToEmpty(item.footnote)}

Return JSON fields:
- chain
- body
- footnote
- chain_en
- body_en
- footnote_en`
			}
		];
}

function revisionResponseFormat() {
	return {
			type: 'json_schema',
			json_schema: {
				name: 'hadith_revision',
				strict: true,
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						chain: { type: 'string' },
						body: { type: 'string' },
						footnote: { type: 'string' },
						chain_en: { type: 'string' },
						body_en: { type: 'string' },
						footnote_en: { type: 'string' }
					},
					required: ['chain', 'body', 'footnote', 'chain_en', 'body_en', 'footnote_en']
				}
			}
	};
}

function parseJson(content) {
	try {
		return JSON.parse(content);
	} catch (e) {
		var match = content.match(/\{[\s\S]*\}/);
		if (match)
			return JSON.parse(match[0]);
		throw e;
	}
}

function trimTrailingSlash(value) {
	return Utils.trimToEmpty(value).replace(/\/+$/, '');
}

function normalizeEnglish(text, prefixAI) {
	text = Utils.trimToEmpty(text);
	text = text.replace(/^\[(AI|Machine)\]\s*/i, '');
	text = text.replace(/[«»﴿﴾]/g, '"');
	text = Utils.replacePBUH(text);
	text = normalizeRaEnglish(text);
	text = normalizeAllahHonorific(text);
	if (prefixAI && Utils.isTruthy(text))
		return `[AI] ${text}`;
	return text;
}

function normalizeChainEnglish(text) {
	text = normalizeEnglish(text, false);
	text = normalizeChainNameForms(text);
	return text;
}

function normalizeHadithEnglish(text, prefixAI) {
	text = normalizeEnglish(text, prefixAI);
	text = normalizeHadithNameForms(text);
	return text;
}

function normalizeArabic(text) {
	text = Utils.trimToEmpty(text);
	text = Utils.replacePBUH(text);
	text = normalizeRaArabic(text);
	text = normalizeAllahHonorific(text);
	return text;
}

function assertArabicDiacriticsPreserved(item, revisedChain, revisedBody, revisedFootnote) {
	var sourceText = [
		normalizeArabic(item.chain),
		normalizeArabic(item.body),
		normalizeArabic(item.footnote)
	].join('\n');
	var revisedText = [
		revisedChain,
		revisedBody,
		revisedFootnote
	].join('\n');
	var sourceCount = countArabicDiacritics(sourceText);
	var revisedCount = countArabicDiacritics(revisedText);

	if (sourceCount < MIN_DIACRITICS_TO_VALIDATE)
		return;
	if (revisedCount >= Math.floor(sourceCount * MIN_DIACRITIC_PRESERVATION_RATIO))
		return;

	throw new Error(`Model stripped Arabic tashkīl for ${item.ref}: kept ${revisedCount}/${sourceCount} diacritics`);
}

function countArabicDiacritics(text) {
	return (Utils.trimToEmpty(text).match(ARABIC_DIACRITICS_RE) || []).length;
}

function sqlValue(value) {
	return mysql.escape(Utils.trimToEmpty(value));
}

async function reindexHeadings(item) {
	var headingIds = [item.h1_id, item.h2_id, item.h3_id]
		.map((id) => parseInt(id, 10))
		.filter((id) => Number.isInteger(id) && id > 0);
	for (var headingId of headingIds) {
		var heading = (await global.query(`SELECT * FROM v_toc WHERE hId=${headingId}`))[0];
		if (heading)
			await Index.update(Heading.INDEX, heading);
	}
}

function normalizeRaEnglish(text) {
	if (Utils.isFalsey(text))
		return text;

	text = text.replace(/\b(?:may\s+)?(?:allah|god)\s+be\s+pleased\s+with\s+(?:him|her|them)\b/gi, 'ᴿᴬ');
	text = text.replace(/\b(?:may\s+)?(?:allah|god)\s+be\s+pleased\s+with\s+both\s+of\s+them\b/gi, 'ᴿᴬ');

	return text;
}

function normalizeRaArabic(text) {
	if (Utils.isFalsey(text))
		return text;

	text = text.replace(/(?:رض(?:ي|ى)\s+الله\s+عن(?:ه|ها|هم|هن|كما|هما|كم|كن))/g, 'ؓ');

	return text;
}

function normalizeAllahHonorific(text) {
	if (Utils.isFalsey(text))
		return text;

	text = text.replace(/الله\s+(?:سبحانه\s+وتعالى|تعالى|عز\s+وجل|جل\s+جلاله)/g, 'الله ﷻ');
	text = text.replace(/\bAllah\b(?:,?\s+(?:the\s+)?(?:Exalted|Almighty|All-Mighty|Most High))/gi, 'Allah ﷻ');
	text = text.replace(/\bAllah\b(?:,?\s+(?:Most Blessed and Exalted|Glorified and Exalted is He))/gi, 'Allah ﷻ');
	text = text.replace(/\bAllah\b\s*\((?:Most Blessed and Exalted|Glorified and Exalted is He)\)/gi, 'Allah ﷻ');

	return text;
}

function normalizeChainNameForms(text) {
	if (Utils.isFalsey(text))
		return text;

	text = text.replace(/\b(?:ʿ)?Abd\s*[- ]?\s*Allah\b/gi, 'ʿAbdullāh');
	text = text.replace(/\b(?:ʿ)?Ubayd\s*[- ]?\s*Allah\b/gi, 'ʿUbaydullāh');
	text = text.replace(/\b(?:ʿ)?Ubaid\s*[- ]?\s*Allah\b/gi, 'ʿUbaydullāh');

	return text;
}

function normalizeHadithNameForms(text) {
	if (Utils.isFalsey(text))
		return text;

	text = text.replace(/\b(?:ʿ)?Abd\s*[- ]?\s*Allah\b/gi, 'Abdullah');
	text = text.replace(/\b(?:ʿ)?Ubayd\s*[- ]?\s*Allah\b/gi, 'Ubaydullah');
	text = text.replace(/\b(?:ʿ)?Ubaid\s*[- ]?\s*Allah\b/gi, 'Ubaydullah');

	return text;
}

module.exports = {
	reviseHadith,
	reviseHadithById,
	buildRevisionMessages,
	buildRevisionRequestData,
	revisionResponseFormat,
	parseJson,
	normalizeArabic,
	normalizeEnglish,
	normalizeHadithEnglish,
	countArabicDiacritics
};
