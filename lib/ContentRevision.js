/* jslint node:true, esversion:11 */
'use strict';

const axios = require('axios');
const createError = require('http-errors');
const Utils = require('./Utils');
const Books = require('./Books');
const Tafsir = require('./Tafsir');

const TYPES = Object.freeze({
	hdith_sharh: {
		label: 'hadith explanation',
		table: 'hdith_hadith_sharh',
		fields: ['text', 'text_en']
	},
	hdith_toc_sharh: {
		label: 'chapter or section explanation',
		table: 'hdith_toc_sharh',
		fields: ['text', 'text_en']
	},
	toc: {
		label: 'chapter, section, or introduction article',
		table: 'toc',
		fields: ['intro', 'intro_en']
	},
	commentary: {
		label: 'tafsir passage',
		table: 'hadiths_commentary',
		fields: ['text', 'text_en', 'footnotes', 'footnotes_en']
	}
});

async function revise(type, id, options) {
	options = options || {};
	const definition = TYPES[type];
	id = Number(id);
	if (!definition || !Number.isSafeInteger(id) || id <= 0)
		throw createError(400, 'Invalid content revision target');
	const source = await load(type, id);
	if (!source)
		throw createError(404, 'Content revision target not found');
	const result = await requestRevision(source, definition, options);
	const fields = normalizeMarkdownFootnotes(definition, normalizedFields(definition.fields, result));
	validateRevision(source, definition, fields);
	const auditFields = type === 'toc'
		? `, lastfixed=CURRENT_TIMESTAMP()${options.userId ? `, lastmod_user=${sql(options.userId)}` : ''}`
		: '';
	await global.query(`UPDATE ${definition.table} SET ${definition.fields.map(field => `${field}=${sql(fields[field])}`).join(', ')}${auditFields} WHERE id=${id}`);
	return { source, fields };
}

async function load(type, id) {
	if (type === 'hdith_sharh') {
		return (await global.query(`SELECT hs.id, hs.hadith_id, hs.text, hs.text_en,
			COALESCE(NULLIF(hs.title, ''), ss.title) AS source_title,
			COALESCE(NULLIF(hs.title_en, ''), ss.title_en) AS source_title_en,
			h.ref, h.book_alias, h.book_name, h.book_name_en, h.h1_title, h.h1_title_en
			FROM hdith_hadith_sharh hs
			JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
			JOIN v_hadiths h ON h.hId=hs.hadith_id
			WHERE hs.id=${id} LIMIT 1`))[0];
	}
	if (type === 'hdith_toc_sharh') {
		return (await global.query(`SELECT ts.id, ts.toc_id, ts.text, ts.text_en,
			COALESCE(NULLIF(ts.title, ''), ss.title) AS source_title,
			COALESCE(NULLIF(ts.title_en, ''), ss.title_en) AS source_title_en,
			t.bookId AS book_id, b.alias AS book_alias, b.shortName AS book_name,
			b.shortName_en AS book_name_en, t.title AS heading_title, t.title_en AS heading_title_en
			FROM hdith_toc_sharh ts
			JOIN hdith_sharh_sources ss ON ss.id=ts.source_id
			JOIN toc t ON t.id=ts.toc_id JOIN books b ON b.id=t.bookId
			WHERE ts.id=${id} LIMIT 1`))[0];
	}
	if (type === 'toc') {
		return (await global.query(`SELECT t.id, t.bookId AS book_id, t.h1, t.h2, t.h3,
			t.title AS heading_title, t.title_en AS heading_title_en, t.intro, t.intro_en,
			b.alias AS book_alias, b.shortName AS book_name, b.shortName_en AS book_name_en,
			b.author, b.author_en
			FROM toc t JOIN books b ON b.id=t.bookId WHERE t.id=${id} LIMIT 1`))[0];
	}
	if (type === 'commentary') {
		const join = await Books.commentaryJoin('bc', 'hc');
		return (await global.query(`SELECT hc.id, hc.text, hc.text_en, hc.footnotes, hc.footnotes_en,
			hc.surah, hc.ayahFrom, hc.ayahTo, ${join.bookIdSelect},
			bc.alias AS book_alias, bc.shortName AS book_name, bc.shortName_en AS book_name_en,
			bc.author, bc.author_en
			FROM ${join.from} ${join.join}
			WHERE hc.id=${id} AND bc.source='local' AND ${join.typePredicate} LIMIT 1`))[0];
	}
	return null;
}

async function requestRevision(source, definition, options) {
	const schema = responseFormat(definition.fields);
	const data = {
		model: options.model || Utils.getOpenAIModel(),
		reasoning_effort: options.reasoning_effort || 'medium',
		messages: buildMessages(source, definition),
		response_format: schema
	};
	try {
		const response = await axios.post('https://api.openai.com/v1/chat/completions', data, {
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${global.settings.openAI.key}`
			}
		});
		const content = Utils.trimToEmpty(response.data.choices?.[0]?.message?.content);
		if (!content)
			throw new Error('Empty OpenAI response');
		return JSON.parse(content);
	} catch (err) {
		if (err.status || err.statusCode)
			throw err;
		const upstream = Utils.trimToEmpty(err.response?.data?.error?.message || err.response?.statusText || err.message);
		throw createError(err.response?.status === 429 ? 429 : 502,
			err.response?.status === 429 ? 'The AI revision service is busy. Please wait and try again.' : `The AI revision service is temporarily unavailable${upstream ? `: ${upstream}` : '.'}`);
	}
}

function buildMessages(source, definition) {
	const fieldText = definition.fields.map(field => `${field}:\n${Utils.trimToEmpty(source[field])}`).join('\n\n');
	const range = source.surah ? `${source.surah}:${source.ayahFrom}${Number(source.ayahTo) > Number(source.ayahFrom) ? `-${source.ayahTo}` : ''}` : '';
	return [{
		role: 'system',
		content: `${Utils.classicalIslamicLiteraturePrompt()}
You are revising a ${definition.label} in Arabic and/or English. Return only strict JSON matching the schema.
Preserve the author's meaning, claims, attributions, Markdown structure, Arabic tashkil, and every existing citation. Correct language, punctuation, paragraphing, and obvious transcription errors without summarizing or adding interpretation.
When Arabic exists, revise it faithfully and create or revise the English field as a complete translation. When only English exists, revise the English and leave the Arabic field empty. For paired footnotes, follow the same rule.
Identify explicit or unmistakable Quran quotations and Quranic phrases. In Arabic surround their wording with Quran verse marks like ﴿النص﴾. In English retain standard English double quotation marks like "text"; do not use ﴿...﴾ in English. Add a missing Quran reference when the surah and ayah can be identified confidently; never guess. Format its Markdown link as ([Āl ʿImrān 3:29](https://quran.islamunlocked.com/quran:3:29)) in English and ([آل عمران ٣:٢٩](https://quran.islamunlocked.com/quran:3:29)) in Arabic. Use the correct localized surah name and digits in the label, and ASCII digits in the URL.
Identify quoted hadith wording. In Arabic surround it with guillemets like «النص». In English retain standard English double quotation marks like "text"; do not use «...» in English. Link every identifiable hadith citation in Markdown, for example ([Muslim 2985](https://hadithunlocked.com/muslim:2985)) in English and ([مسلم ٢٩٨٥](https://hadithunlocked.com/muslim:2985)) in Arabic. Use the canonical Hadith Unlocked alias and ASCII reference in the URL. Do not manufacture a hadith reference when the collection and number cannot be established confidently.
Convert existing plain-text Quran and hadith references to those links. Do not change an already correct link target. Do not put the quoted verse or hadith itself inside the citation link.
Keep Quran and hadith citation links inline in parentheses unless the source intentionally places the citation in a footnote. Preserve linked inline footnotes in the form [^[Dhāriyāt 51:56–57](https://quran.islamunlocked.com/quran:51:56-57)].
Preserve existing Markdown footnote references and definitions. When an editorial or source note belongs in a footnote, use standard Markdown footnote syntax in the matching language, with a reference such as [^1] and a definition such as [^1]: Note text. A short inline footnote may use ^[Note text], and an inline footnote containing a link may use [^[Label](https://example.com)]. Keep Arabic and English footnote numbering independently sequential. For fields without a separate footnotes field, keep the definitions at the end of the corresponding text or intro field. For tafsir fields with separate footnotes and footnotes_en fields, keep the definitions in the matching footnotes field. Do not invent footnotes.
Use ﷺ, ؓ, ᴿᴬ, and ﷻ according to the language and context. In English personal names use b. and bt. rather than ibn/bin and bint.`
	}, {
		role: 'user',
		content: `Revise this content in one pass.

content_type: ${definition.label}
book_alias: ${Utils.trimToEmpty(source.book_alias)}
book_title: ${Utils.trimToEmpty(source.book_name_en || source.book_name)}
book_title_arabic: ${Utils.trimToEmpty(source.book_name)}
author: ${Utils.trimToEmpty(source.author_en || source.author)}
source_title: ${Utils.trimToEmpty(source.source_title_en || source.source_title)}
source_title_arabic: ${Utils.trimToEmpty(source.source_title)}
heading: ${Utils.trimToEmpty(source.heading_title_en || source.h1_title_en || source.heading_title || source.h1_title)}
quran_passage_range: ${range}

${fieldText}`
	}];
}

function responseFormat(fields) {
	const properties = {};
	fields.forEach(field => { properties[field] = { type: 'string' }; });
	return {
		type: 'json_schema',
		json_schema: {
			name: 'content_revision',
			strict: true,
			schema: { type: 'object', additionalProperties: false, properties, required: fields }
		}
	};
}

function normalizedFields(fields, result) {
	const normalized = {};
	fields.forEach(field => {
		normalized[field] = Utils.trimToEmpty(result && result[field]);
		if (field.endsWith('_en'))
			normalized[field] = normalized[field].replace(/[«﴿]/g, '"').replace(/[»﴾]/g, '"');
	});
	return normalized;
}

function normalizeMarkdownFootnotes(definition, fields) {
	if (definition.fields.includes('footnotes')) {
		for (const suffix of ['', '_en']) {
			const textField = `text${suffix}`;
			const footnotesField = `footnotes${suffix}`;
			if (!/\[\^[^\[\]\n]+\]/.test(`${fields[textField]}\n${fields[footnotesField]}`))
				continue;
			const normalized = Tafsir.renumberMarkdownFootnotes(fields[textField], fields[footnotesField]);
			fields[textField] = normalized.text;
			fields[footnotesField] = normalized.footnotes;
		}
		return fields;
	}
	for (const field of definition.fields) {
		if (!/\[\^[^\[\]\n]+\]/.test(fields[field]))
			continue;
		fields[field] = Tafsir.renumberMarkdownFootnotes(fields[field], '').text;
	}
	return fields;
}

function validateRevision(source, definition, fields) {
	const primary = definition.fields.filter(field => !field.endsWith('_en'));
	for (const field of definition.fields) {
		if (Utils.isTruthy(source[field]) && Utils.isFalsey(fields[field]))
			throw new Error(`Revision omitted ${field}`);
	}
	for (const field of primary) {
		if (Utils.isTruthy(source[field]) && Utils.isFalsey(fields[`${field}_en`]))
			throw new Error(`Revision omitted English translation for ${field}`);
	}
	const existingLinks = new Set(definition.fields.flatMap(field => Utils.trimToEmpty(source[field]).match(/https?:\/\/[^\s)]+/g) || []));
	for (const [field, value] of Object.entries(fields)) {
		const links = value.match(/https?:\/\/[^\s)]+/g) || [];
		if (links.some(link => !existingLinks.has(link) && !/^https:\/\/(?:hadithunlocked\.com\/[a-z0-9-]+:[a-z0-9.-]+|quran\.islamunlocked\.com\/quran:\d+:\d+(?:-\d+)?)$/i.test(link)))
			throw new Error(`Revision returned an unsupported link in ${field}`);
	}
}

function sql(value) {
	return require('mysql').escape(value == null ? '' : value.toString());
}

module.exports = { TYPES, buildMessages, normalizeMarkdownFootnotes, responseFormat, revise };
