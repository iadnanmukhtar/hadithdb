/* jslint node:true, esversion:9 */
'use strict';

const crypto = require('crypto');
const axios = require('axios');
const MySQL = require('mysql');
const createError = require('http-errors');
const debug = require('./Debug')('hadithdb:ContentTranslations');
const Utils = require('./Utils');
const Books = require('./Books');
const HadithRevision = require('./HadithRevision');
const PaymentConfig = require('./PaymentConfig');
const UserPoints = require('./UserPoints');

function sql(value) {
  return MySQL.escape(value);
}

function normalizeMode(mode) {
  mode = Utils.trimToEmpty(mode || 'translate').toLowerCase();
  return mode === 'fix' ? 'fix' : 'translate';
}

function assertEnabled() {
  if (!PaymentConfig.isEnabled())
    throw createError(503, 'Content translation is disabled.');
}

function normalizeItemType(value) {
  value = Utils.trimToEmpty(value).toLowerCase();
  if (value === 'hadith' || value === 'tafsir')
    return value;
  throw createError(400, 'Invalid content type.');
}

function normalizeLanguage(value, options) {
  options = options || {};
  value = Utils.trimToEmpty(value).toLowerCase();
  if (value === 'ar' && options.allowArabicFix === true)
    return { code: 'ar', label: 'Arabic', dir: 'rtl' };
  const language = PaymentConfig.supportedLanguage(value);
  if (!language)
    throw createError(400, 'Unsupported language.');
  return language;
}

function compactText(value) {
  return Utils.trimToEmpty(value).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function contentHash(source) {
  return crypto.createHash('sha256').update(JSON.stringify(source || {})).digest('hex');
}

function translationCacheHash(source) {
  if (source && source.promptContext)
    return contentHash({ fields: source.fields, promptContext: source.promptContext });
  return contentHash(source && source.fields);
}

function wordCount(value) {
  value = Utils.trimToEmpty(value)
    .replace(/(?:^|\n)[ \t]*\[\^[^\]\n]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/g, ' ')
    .replace(/\[\^[^\]\n]+\]/g, ' ')
    .replace(/[`*_>#()[\]{}|~!?,.;:"“”‘’،؛؟]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value)
    return 0;
  const words = value.match(/[\p{L}\p{M}\p{N}]+(?:[-'][\p{L}\p{M}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

function sourceWordCount(source) {
  return Object.values(source.fields || {}).reduce((sum, value) => sum + wordCount(value), 0);
}

function estimatePoints(source, mode) {
  const words = sourceWordCount(source);
  if (words < 1)
    return 0;
  const per1000 = PaymentConfig.pointsPer1000Words(mode);
  return Math.max(PaymentConfig.minimumPoints(mode), Math.ceil((words / 1000) * per1000));
}

function estimateFields(fields, mode) {
  const source = {
    fields: Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, compactText(value)]))
  };
  return {
    points: estimatePoints(source, normalizeMode(mode)),
    wordCount: sourceWordCount(source)
  };
}

function freeExistingContent(source, targetLanguage, mode) {
  if (mode !== 'translate')
    return null;
  if (targetLanguage.code === 'ar' && source.languages && source.languages.ar && Object.values(source.languages.ar).some(Boolean))
    return source.languages.ar;
  if (targetLanguage.code === 'en' && source.languages && source.languages.en && Object.values(source.languages.en).some(Boolean))
    return source.languages.en;
  return null;
}

function sourceForTask(source, targetLanguage, mode) {
  if (mode !== 'fix')
    return source;
  const languageFields = source.languages && source.languages[targetLanguage.code];
  if (!languageFields || !Object.values(languageFields).some(Boolean))
    return source;
  return {
    ...source,
    sourceLanguage: targetLanguage.label,
    fields: languageFields
  };
}

async function loadHadithSource(itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isInteger(id) || id <= 0)
    throw createError(400, 'Invalid hadith id.');
  const row = (await global.query(`
    SELECT *
    FROM v_hadiths
    WHERE hId=${id}
    LIMIT 1
  `))[0];
  if (!row)
    throw createError(404, 'Hadith not found.');
  const ar = {
    title: compactText(row.title),
    chain: compactText(row.chain),
    body: compactText(row.body),
    footnote: compactText(row.footnote)
  };
  const en = {
    title: compactText(row.title_en),
    chain: compactText(row.chain_en),
    body: compactText(row.body_en),
    footnote: compactText(row.footnote_en)
  };
  const fields = Object.fromEntries(Object.entries(ar).map(([key, value]) => [key, value || en[key] || '']));
  return {
    itemType: 'hadith',
    itemId: id.toString(),
    ref: row.ref || `${row.book_alias || 'hadith'}:${row.num || id}`,
    sourceLanguage: Object.values(ar).some(Boolean) ? 'Arabic' : 'English',
    fields,
    languages: { ar, en }
  };
}

async function loadTafsirSource(itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isInteger(id) || id <= 0)
    throw createError(400, 'Invalid tafsir passage id.');
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  const row = (await global.query(`
    SELECT
      bc.alias,
      bc.shortName,
      bc.shortName_en,
      bc.name_en,
      bc.title,
      bc.author_en,
      bc.author,
      bc.lang,
      hc.id,
      hc.surah,
      hc.ayahFrom,
      hc.ayahTo,
      hc.text,
      hc.text_en,
      hc.footnotes,
      hc.footnotes_en
    FROM ${commentaryJoin.from}
    ${commentaryJoin.join}
    WHERE hc.id=${id}
      AND bc.source='local'
      AND bc.hidden=0
      AND ${commentaryJoin.typePredicate}
    LIMIT 1
  `))[0];
  if (!row)
    throw createError(404, 'Tafsir passage not found.');
  const ar = {
    text: compactText(row.text),
    footnotes: compactText(row.footnotes)
  };
  const en = {
    text: compactText(row.text_en),
    footnotes: compactText(row.footnotes_en)
  };
  const fields = Object.fromEntries(Object.entries(ar).map(([key, value]) => [key, value || en[key] || '']));
  const bookTitle = compactText(row.shortName_en || row.name_en || row.shortName || row.title || row.alias || 'Tafsir');
  const bookTitleArabic = compactText(row.shortName || row.title || '');
  const author = compactText(row.author_en || row.author || '');
  const authorArabic = compactText(row.author || '');
  const ayahFrom = Number(row.ayahFrom);
  const ayahTo = Number(row.ayahTo);
  const passageRange = `${row.surah}:${row.ayahFrom}${ayahTo > ayahFrom ? `-${row.ayahTo}` : ''}`;
  return {
    itemType: 'tafsir',
    itemId: id.toString(),
    ref: `${row.alias || 'tafsir'}:${passageRange}`,
    sourceLanguage: Object.values(ar).some(Boolean) ? 'Arabic' : 'English',
    fields,
    promptContext: {
      content_type: 'tafsir',
      book_alias: row.alias || '',
      book_title: bookTitle,
      book_title_arabic: bookTitleArabic,
      author,
      author_arabic: authorArabic,
      book_language: row.lang || '',
      quran_passage_range: passageRange
    },
    languages: { ar, en }
  };
}

async function loadSource(itemType, itemId) {
  itemType = normalizeItemType(itemType);
  if (itemType === 'tafsir')
    return loadTafsirSource(itemId);
  return loadHadithSource(itemId);
}

function normalizeModelContent(fields, result) {
  result = result && typeof result === 'object' ? result : {};
  const content = {};
  Object.keys(fields || {}).forEach(key => {
    content[key] = compactText(result[key]);
  });
  return content;
}

function shouldUseHadithRevision(user, source, targetLanguage, mode) {
  return source
    && source.itemType === 'hadith'
    && targetLanguage
    && targetLanguage.code === 'en'
    && mode === 'translate'
    && user;
}

function hadithRevisionContent(result) {
  const item = result && result.item || {};
  return {
    title: compactText(item.title_en),
    chain: compactText(item.chain_en),
    body: compactText(item.body_en),
    footnote: compactText(item.footnote_en)
  };
}

async function requestHadithRevision(source, user) {
  debug(`hadith revision translation start type=${source.itemType} id=${source.itemId} lang=en`);
  const result = await HadithRevision.reviseHadithById(source.itemId, {
    userId: user.uid,
    awaitMaintenance: true,
    throwOnMaintenanceError: true
  });
  debug(`hadith revision translation done type=${source.itemType} id=${source.itemId} lang=en`);
  return {
    model: 'hadith-revision',
    content: hadithRevisionContent(result),
    sourceUpdated: true,
    indexed: true
  };
}

function responseSchema(fields) {
  const properties = {};
  const required = [];
  Object.keys(fields || {}).forEach(key => {
    properties[key] = { type: 'string' };
    required.push(key);
  });
  return {
    type: 'json_schema',
    json_schema: {
      name: 'content_translation',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties,
        required
      }
    }
  };
}

function buildMessages(source, targetLanguage, mode) {
  const task = mode === 'fix'
    ? `Correct obvious typos, spacing, punctuation, and formatting in this ${source.sourceLanguage} content without changing meaning.`
    : `Translate this ${source.sourceLanguage} content into ${targetLanguage.label}.`;
  const payload = {
    task,
    reference: source.ref
  };
  if (source.promptContext)
    payload.context = source.promptContext;
  payload.target_language = targetLanguage.label;
  payload.fields = source.fields;
  return [
    {
      role: 'system',
      content:
`You are helping readers understand Islamic source texts.
Return only strict JSON with the same field names as the input.
Preserve meaning, names, citations, hadith honorifics, Quran references, markdown, and paragraph breaks.
Use any provided context about the tafsir book, author, and Quran passage range only to disambiguate the translation.
Do not translate, summarize, or output the context unless that information appears in an input field.
Do not summarize, explain, add commentary, or include fields that were not requested.
If an input field is empty, return an empty string for that field.`
    },
    {
      role: 'user',
      content: JSON.stringify(payload, null, 2)
    }
  ];
}

async function requestModel(source, targetLanguage, mode) {
  const model = Utils.getOpenAIModel();
  const data = {
    model,
    messages: buildMessages(source, targetLanguage, mode),
    response_format: responseSchema(source.fields)
  };
  const t0 = Date.now();
  let response;
  try {
    debug(`content translation start mode=${mode} type=${source.itemType} id=${source.itemId} lang=${targetLanguage.code} model=${model}`);
    response = await axios.post('https://api.openai.com/v1/chat/completions', data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${global.settings.openAI.key}`
      }
    });
    const elapsedMs = Date.now() - t0;
    debug(`content translation done mode=${mode} type=${source.itemType} id=${source.itemId} lang=${targetLanguage.code} elapsedMs=${elapsedMs}`);
    debug.slow('OpenAI content translation', elapsedMs, `mode=${mode} type=${source.itemType} id=${source.itemId} lang=${targetLanguage.code}`);
  } catch (err) {
    debug.error(`content translation failed mode=${mode} type=${source.itemType} id=${source.itemId} lang=${targetLanguage.code} status=${err.response?.status || 'n/a'}: ${err.response?.statusText || err.message}\n${err.stack || ''}`);
    throw err;
  }
  const text = Utils.trimToEmpty(response.data?.choices?.[0]?.message?.content);
  if (!text)
    throw new Error('Empty translation response.');
  return {
    model,
    content: normalizeModelContent(source.fields, JSON.parse(text))
  };
}

async function estimate(user, itemType, itemId, targetLanguage, mode) {
  assertEnabled();
  await UserPoints.ensureTables();
  mode = normalizeMode(mode);
  targetLanguage = normalizeLanguage(targetLanguage, { allowArabicFix: mode === 'fix' });
  const source = await loadSource(itemType, itemId);
  const taskSource = sourceForTask(source, targetLanguage, mode);
  const useHadithRevision = shouldUseHadithRevision(user, source, targetLanguage, mode);
  const existingFree = useHadithRevision ? null : freeExistingContent(source, targetLanguage, mode);
  const hash = translationCacheHash(taskSource);
  const cached = existingFree || useHadithRevision ? null : await UserPoints.contentTranslation(user, source.itemType, source.itemId, targetLanguage.code, mode, hash);
  return {
    itemType: source.itemType,
    itemId: source.itemId,
    reference: source.ref,
    targetLanguage,
    mode,
    sourceHash: hash,
    points: existingFree || cached ? 0 : estimatePoints(taskSource, mode),
    wordCount: sourceWordCount(taskSource),
    cached: Boolean(existingFree || cached),
    balance: user ? await UserPoints.balance(user) : null
  };
}

async function translate(user, itemType, itemId, targetLanguage, mode) {
  assertEnabled();
  user = await UserPoints.ensureUser(user);
  mode = normalizeMode(mode);
  targetLanguage = normalizeLanguage(targetLanguage, { allowArabicFix: mode === 'fix' });
  const source = await loadSource(itemType, itemId);
  const taskSource = sourceForTask(source, targetLanguage, mode);
  const hash = translationCacheHash(taskSource);
  const useHadithRevision = shouldUseHadithRevision(user, source, targetLanguage, mode);
  const existingFree = useHadithRevision ? null : freeExistingContent(source, targetLanguage, mode);
  if (existingFree) {
    return {
      content: existingFree,
      points: 0,
      balance: await UserPoints.balance(user),
      cached: true,
      free: true,
      targetLanguage,
      reference: source.ref
    };
  }
  const cached = useHadithRevision ? null : await UserPoints.contentTranslation(user, source.itemType, source.itemId, targetLanguage.code, mode, hash);
  if (cached) {
    return {
      content: cached.content,
      points: 0,
      balance: await UserPoints.balance(user),
      cached: true,
      targetLanguage,
      reference: source.ref
    };
  }
  const points = estimatePoints(taskSource, mode);
  const debitReference = `translation:${user.uid}:${source.itemType}:${source.itemId}:${targetLanguage.code}:${mode}:${hash}`;
  const debit = await UserPoints.debitPoints(user, points, 'content_translation', 'content_translation', debitReference, {
    itemType: source.itemType,
    itemId: source.itemId,
    targetLanguage: targetLanguage.code,
    mode,
    ref: source.ref
  });
  try {
    const generated = useHadithRevision ? await requestHadithRevision(source, user) : await requestModel(taskSource, targetLanguage, mode);
    await UserPoints.saveContentTranslation(user, source.itemType, source.itemId, targetLanguage.code, mode, hash, generated.content, generated.model, points);
    return {
      content: generated.content,
      points,
      balance: debit.balance,
      cached: false,
      sourceUpdated: generated.sourceUpdated === true,
      indexed: generated.indexed === true,
      targetLanguage,
      reference: source.ref
    };
  } catch (err) {
    await UserPoints.creditPoints(user, points, 'content_translation_refund', 'content_translation_refund', `refund:${debitReference}`, {
      itemType: source.itemType,
      itemId: source.itemId,
      targetLanguage: targetLanguage.code,
      mode,
      error: err.message
    });
    throw err;
  }
}

module.exports = {
  estimate,
  estimateFields,
  estimatePoints,
  buildMessages,
  loadSource,
  normalizeLanguage,
  normalizeMode,
  supportedLanguages: PaymentConfig.supportedLanguages,
  translate
};
