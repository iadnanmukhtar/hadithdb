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
	var needsTitle = shouldRegenerateTitle(item.title_en);
	var result = await requestRevision(item, needsTitle, options);
	var sourceHasChain = Utils.isTruthy(item.chain);

	var chain = sourceHasChain ? normalizeArabic(result.chain) : '';
	var body = normalizeArabic(result.body);
	var chain_en = sourceHasChain ? normalizeChainEnglish(result.chain_en) : '';
	var body_en = normalizeHadithEnglish(result.body_en, true);
	var footnote_en = Utils.isTruthy(item.footnote) ? normalizeHadithEnglish(result.footnote_en, true) : Utils.trimToEmpty(item.footnote_en);
	var title_en = needsTitle ? normalizeHadithEnglish(result.title_en, false) : '';

	if ((sourceHasChain && Utils.isFalsey(chain)) || Utils.isFalsey(body) || Utils.isFalsey(body_en))
		throw new Error(`Model returned incomplete data for ${item.ref}`);
	if (Utils.isTruthy(item.footnote) && Utils.isFalsey(footnote_en))
		throw new Error(`Model returned incomplete footnote translation for ${item.ref}`);
	assertArabicDiacriticsPreserved(item, chain, body);

	var updates = [
		`chain=${sqlValue(chain)}`,
		`body=${sqlValue(body)}`,
		`chain_en=${sqlValue(chain_en)}`,
		`body_en=${sqlValue(body_en)}`,
		`temp_trans=1`,
		`lastfixed=CURRENT_TIMESTAMP()`
	];

	if (options.userId)
		updates.push(`lastmod_user=${sqlValue(options.userId)}`);
	if (needsTitle && Utils.isTruthy(title_en))
		updates.push(`title_en=${sqlValue(title_en)}`);
	if (Utils.isTruthy(item.footnote))
		updates.push(`footnote_en=${sqlValue(footnote_en)}`);

	await global.query(`UPDATE hadiths SET ${updates.join(', ')} WHERE id=${item.hId}`);

	var refreshed = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${item.hId}`))[0];
	var maintenance = runPostRevisionMaintenance(refreshed, options);
	if (options.awaitMaintenance === true)
		await maintenance;

	return {
		item: refreshed,
		changed: {
			chain: chain,
			body: body,
			chain_en: chain_en,
			body_en: body_en,
			footnote_en: footnote_en,
			title_en: needsTitle ? title_en : item.title_en
		},
		maintenance: options.awaitMaintenance === true ? { completed: true } : { completed: false }
	};
}

function runPostRevisionMaintenance(item, options) {
	options = options || {};
	var indexTask = (async () => {
		await safeBackground(`flushing cache for ${item.ref}`, async () => {
			await Utils.flushCacheContaining(`${item.book_alias}:${item.num}`);
		});
		await safeBackground(`reindexing hadith ${item.ref}`, async () => {
			await Index.update(Item.INDEX, item);
		}, options);
		await safeBackground(`reindexing headings for ${item.ref}`, async () => {
			await reindexHeadings(item);
		}, options);
	})();
	var maintenanceTask = indexTask.then(async () => {
		if (options.syncKnowledge !== false)
			await safeBackground(`syncing chatbot knowledge for ${item.ref}`, async () => {
				await HadithKnowledge.syncForHadith(item, { force: true });
			}, options.awaitKnowledge === true ? options : {});
	});
	if (options.awaitMaintenance === true) {
		if (options.awaitKnowledge === true)
			return maintenanceTask;
		maintenanceTask.catch((err) => {
			debug.error(`post-revision knowledge maintenance for ${item.ref}: ${err.message}\n${err.stack || ''}`);
		});
		return indexTask;
	}
	maintenanceTask.catch((err) => {
		debug.error(`post-revision maintenance for ${item.ref}: ${err.message}\n${err.stack || ''}`);
	});
	return maintenanceTask;
}

async function safeBackground(label, fn, options) {
	options = options || {};
	try {
		await fn();
	} catch (err) {
		debug.error(`${label}: ${err.message}\n${err.stack || ''}`);
		if (options.throwOnMaintenanceError === true)
			throw err;
	}
}

async function requestRevision(item, needsTitle, options) {
	options = options || {};
	if (revisionProvider(options) === 'ollama')
		return requestOllamaRevision(item, needsTitle, options);
	return requestOpenAIRevision(item, needsTitle, options);
}

async function requestOpenAIRevision(item, needsTitle, options) {
	options = options || {};
	var data = buildRevisionRequestData(item, needsTitle, {
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

async function requestOllamaRevision(item, needsTitle, options) {
	options = options || {};
	var model = options.model || process.env.OLLAMA_HADITH_REVISION_MODEL || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
	var baseUrl = trimTrailingSlash(options.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL);
	var timeout = options.timeout || Number(process.env.OLLAMA_TIMEOUT_MS) || 300000;
	var data = {
		model: model,
		messages: buildRevisionMessages(item, needsTitle),
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

function buildRevisionRequestData(item, needsTitle, options) {
	options = options || {};
	return {
		model: options.model || Utils.getOpenAIModel(),
		reasoning_effort: options.reasoning_effort || 'medium',
		messages: buildRevisionMessages(item, needsTitle),
		response_format: revisionResponseFormat()
	};
}

function buildRevisionMessages(item, needsTitle) {
	return [
			{
				role: 'system',
				content:
`You are correcting and translating a hadith record.
Return only strict JSON matching the schema.
Preserve the Arabic source text exactly except for moving boundary text between the chain and the body when needed.
Preserve all Arabic tashkīl/ḥarakāt exactly as they appear in the source text. Never strip, simplify, or regenerate diacritics.
Do not invent, omit, summarize, or paraphrase Arabic source text.
The chain is the isnad and the body is the matn.
Some records have no chain. If arabic_chain is empty, return an empty string for chain and chain_en, and keep the entire Arabic report in body.
Do not move Arabic body text into chain just to make chain non-empty.
If the chain contains an opening part of the matn, move that Arabic text to the start of the body.
If the body begins with trailing isnad text, move that Arabic text back into the chain.
Linkage phrases such as "عن", "قال", "سمعت", "أخبرني", and similar narrator connectors belong to the chain.
The body begins when the report content itself starts, such as an action, ruling, description, supplication, or quoted saying.
Do not leave report-introduction phrases about the Prophet ﷺ speaking inside the chain. Phrases such as "أن رسول الله ﷺ قال", "أن النبي ﷺ قال", "قال رسول الله ﷺ", "قال النبي ﷺ", and similar variants belong to the body, including attached continuations such as "لها" or "له".
If the split is not clearly wrong, keep the Arabic fields unchanged.
For the corrected Arabic body, add appropriate Arabic punctuation where needed.
Format the corrected Arabic body as Markdown paragraphs separated by a blank line.
Keep Arabic paragraphs long. Split them primarily at changes of scene, speaker, event, ruling, supplication, or distinct concept.
Do not split Arabic into short sentence-by-sentence paragraphs.
Surround statements of the Prophet ﷺ in the body with Arabic quotation marks inside Markdown italics, like *«...»*.
Surround Qur'anic verses in the body with Qur'anic verse marks ﴿﴾.
Do not add italics or quotation marks around text unless it is actually a Prophetic statement or a Qur'anic verse.
For chain_en, transliterate the narrators from the corrected chain using ALA-LC.
Use "b." for bin or ibn meaning son of, and "bt." for bint meaning daughter of.
Separate each narrator with the ">" sign.
Use "ʿ" for ع and "ʾ" for ء in the ALA-LC transliteration.
Transliterate عبد الله as "ʿAbdullāh" and عبيد الله as "ʿUbaydullāh".
For body_en, translate only the corrected body into clear English.
Format body_en as Markdown paragraphs separated by a blank line, mirroring the Arabic paragraph structure where practical.
Keep English paragraphs long. Split them primarily at changes of scene, speaker, event, ruling, supplication, or distinct concept.
Do not split English into short sentence-by-sentence paragraphs.
For footnote_en, translate only the Arabic footnote into clear English. If there is no Arabic footnote, return an empty string.
When translating footnote_en, use only the corrected Arabic body as context for meaning, pronouns, references, and terminology.
Format footnote_en as Markdown paragraphs separated by a blank line, mirroring the Arabic footnote paragraph structure where practical.
Do not use ALA-LC in the English translation.
Use the simplest common English transliteration for Arabic names and nouns without fancy extended characters and without long-vowel doubling or macrons: use a instead of ā, i instead of ī, and u instead of ū.
When an Arabic word is transliterated in the hadith translation, transliterate ة as "h" rather than "t" or other endings.
Transliterate عبد الله as "Abdullah" and عبيد الله as "Ubaydullah" in the hadith translation.
Surround translated statements of the Prophet ﷺ with standard English quotation marks inside Markdown italics, like *"..."*.
Use standard English quotation marks "..." for translated Qur'anic verses and other quoted material.
Do not use «», ﴿﴾, or other Arabic quotation symbols in English output.
Always use ﷺ instead of spelling out "peace be upon him" or similar variants for the Prophet in both Arabic and English.
Always use ؓ instead of spelling out رضي الله عنه and its Arabic variants in Arabic output.
Always use ᴿᴬ instead of spelling out "may Allah be pleased with him/her/them" and similar variants in English output.
After the name Allah, use ﷻ instead of spelled-out honorifics such as "the Exalted", "the Almighty", "the All-Mighty", and similar variants where that honorific is intended.
For title_en, if title generation is not needed return an empty string.
If it is needed and the Arabic title is present, provide a concise summarized English rendering of that Arabic title in sentence case rather than a word-for-word gloss.
If it is needed and there is no Arabic title, infer a concise English title in sentence case from the corrected body.`
			},
			{
				role: 'user',
				content:
`Revise this hadith in one pass.

title_generation_needed: ${needsTitle ? 'yes' : 'no'}
arabic_title:
${Utils.trimToEmpty(item.title)}

existing_english_title:
${Utils.trimToEmpty(item.title_en)}

arabic_chain:
${Utils.trimToEmpty(item.chain)}

arabic_body:
${Utils.trimToEmpty(item.body)}

arabic_footnote:
${Utils.trimToEmpty(item.footnote)}

Return JSON fields:
- chain
- body
- chain_en
- body_en
- footnote_en
- title_en`
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
						chain_en: { type: 'string' },
						body_en: { type: 'string' },
						footnote_en: { type: 'string' },
						title_en: { type: 'string' }
					},
					required: ['chain', 'body', 'chain_en', 'body_en', 'footnote_en', 'title_en']
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

function shouldRegenerateTitle(title) {
	title = Utils.trimToEmpty(title);
	return Utils.isFalsey(title) || /^\[(AI|Machine)\]\s*/i.test(title);
}

function assertArabicDiacriticsPreserved(item, revisedChain, revisedBody) {
	var sourceText = [
		normalizeArabic(item.chain),
		normalizeArabic(item.body)
	].join('\n');
	var revisedText = [
		revisedChain,
		revisedBody
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
	shouldRegenerateTitle,
	buildRevisionMessages,
	buildRevisionRequestData,
	revisionResponseFormat,
	parseJson,
	normalizeArabic,
	normalizeEnglish,
	normalizeHadithEnglish,
	countArabicDiacritics
};
