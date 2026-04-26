'use strict';

const axios = require('axios');
const mysql = require('mysql');
const Utils = require('./Utils');
const Index = require('./Index');
const HadithKnowledge = require('./HadithKnowledge');
const { Item, Heading } = require('./Model');

async function reviseHadithById(hadithId, options) {
	var item = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${parseInt(hadithId, 10)}`))[0];
	if (!item)
		throw new Error(`Hadith not found: ${hadithId}`);
	return reviseHadith(item, options);
}

async function reviseHadith(item, options) {
	options = options || {};
	var needsTitle = shouldRegenerateTitle(item.title_en);
	var result = await requestRevision(item, needsTitle);

	var chain = normalizeArabic(result.chain);
	var body = normalizeArabic(result.body);
	var chain_en = normalizeChainEnglish(result.chain_en);
	var body_en = normalizeHadithEnglish(result.body_en, true);
	var title_en = needsTitle ? normalizeHadithEnglish(result.title_en, false) : '';

	if (Utils.isFalsey(chain) || Utils.isFalsey(body) || Utils.isFalsey(body_en))
		throw new Error(`Model returned incomplete data for ${item.ref}`);

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

	await global.query(`UPDATE hadiths SET ${updates.join(', ')} WHERE id=${item.hId}`);

	var refreshed = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${item.hId}`))[0];
	runPostRevisionMaintenance(refreshed);

	return {
		item: refreshed,
		changed: {
			chain: chain,
			body: body,
			chain_en: chain_en,
			body_en: body_en,
			title_en: needsTitle ? title_en : item.title_en
		}
	};
}

function runPostRevisionMaintenance(item) {
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
		await safeBackground(`syncing chatbot knowledge for ${item.ref}`, async () => {
			await HadithKnowledge.syncForHadith(item, { force: true });
		});
	})().catch((err) => {
		console.error(`ERROR: post-revision maintenance for ${item.ref}: ${err.message}`);
	});
}

async function safeBackground(label, fn) {
	try {
		await fn();
	} catch (err) {
		console.error(`ERROR: ${label}: ${err.message}`);
	}
}

async function requestRevision(item, needsTitle) {
	var data = {
		model: Utils.getOpenAIModel(),
		reasoning_effort: 'medium',
		messages: [
			{
				role: 'system',
				content:
`You are correcting and translating a hadith record.
Return only strict JSON matching the schema.
Preserve the Arabic source text exactly except for moving boundary text between the chain and the body when needed.
Do not invent, omit, summarize, or paraphrase Arabic source text.
The chain is the isnad and the body is the matn.
If the chain contains an opening part of the matn, move that Arabic text to the start of the body.
If the body begins with trailing isnad text, move that Arabic text back into the chain.
Linkage phrases such as "عن", "قال", "سمعت", "أخبرني", and similar narrator connectors belong to the chain.
The body begins when the report content itself starts, such as an action, ruling, description, supplication, or quoted saying.
Do not leave report-introduction phrases about the Prophet ﷺ speaking inside the chain. Phrases such as "أن رسول الله ﷺ قال", "أن النبي ﷺ قال", "قال رسول الله ﷺ", "قال النبي ﷺ", and similar variants belong to the body, including attached continuations such as "لها" or "له".
Only move text when the split is clearly wrong; otherwise keep the Arabic fields unchanged.
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

existing_english_body:
${Utils.trimToEmpty(item.body_en)}

Return JSON fields:
- chain
- body
- chain_en
- body_en
- title_en`
			}
		],
		response_format: {
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
						title_en: { type: 'string' }
					},
					required: ['chain', 'body', 'chain_en', 'body_en', 'title_en']
				}
			}
		}
	};

	var res = await axios.post('https://api.openai.com/v1/chat/completions', data, {
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${global.settings.openAI.key}`
		}
	});

	var content = Utils.trimToEmpty(res.data.choices?.[0]?.message?.content);
	if (Utils.isFalsey(content))
		throw new Error('Empty OpenAI response');

	return parseJson(content);
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
	normalizeArabic,
	normalizeEnglish
};
