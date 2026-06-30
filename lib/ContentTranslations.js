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
const Payments = require('./Payments');
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
  if (value === 'ar')
    throw createError(400, 'Unsupported language.');
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

function hasAnyContent(content) {
  return Boolean(content && typeof content === 'object' && Object.values(content).some(Boolean));
}

function translationOption(code, content, source) {
  code = Utils.trimToEmpty(code).toLowerCase();
  if (!code || code === 'ar' || !hasAnyContent(content))
    return null;
  const language = PaymentConfig.supportedLanguage(code);
  if (!language)
    return null;
  return {
    code: language.code,
    label: language.label,
    dir: language.dir,
    source: source || 'translation',
    content
  };
}

async function requestHadithRevision(source, user) {
  debug(`hadith revision translation start type=${source.itemType} id=${source.itemId} lang=en`);
  const result = await HadithRevision.reviseHadithById(source.itemId, {
    userId: user.uid,
    awaitMaintenance: true,
    throwOnMaintenanceError: true,
    skipArabicRevisionIfCurrent: true,
    source: 'content_translation'
  });
  debug(`hadith revision translation done type=${source.itemType} id=${source.itemId} lang=en skipArabicRevision=${result.arabicRevisionSkipped === true}`);
  return {
    model: result.arabicRevisionSkipped === true ? 'hadith-revision-translation' : 'hadith-revision',
    content: hadithRevisionContent(result),
    sourceUpdated: true,
    indexed: true
  };
}

function checkoutExpected(source, targetLanguage, mode) {
  return {
    itemType: source.itemType,
    itemId: source.itemId,
    targetLanguage: targetLanguage.code,
    mode
  };
}

async function cancelCheckoutSilently(user, checkoutSessionId, expected, reason) {
  checkoutSessionId = Utils.trimToEmpty(checkoutSessionId);
  if (!checkoutSessionId)
    return;
  try {
    await Payments.cancelContentTranslationCheckout(user, checkoutSessionId, expected);
  } catch (err) {
    debug.error(`content translation checkout cancel failed reason=${reason || 'unknown'} session=${checkoutSessionId}: ${err.message}\n${err.stack || ''}`);
  }
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
  const chainInstruction = source.itemType === 'hadith'
    ? 'For any hadith sanad/isnad field named "chain" or "chain_en", extract only narrator names and separate them with the ">" sign. Do not translate the chain literally. Do not output narration verbs, attribution phrases, or connectors such as "narrated to us", "reported to us", "informed us", "from", "on the authority of", "he said", or equivalents in the target language. The chain field output must contain only narrator names and ">" separators; if there is one narrator, output only that narrator name.'
    : '';
  const payload = {
    task,
    content_type: source.itemType,
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
${chainInstruction}
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
    if (err.response) {
      const status = Number(err.response.status || 0);
      const message = Utils.trimToEmpty(err.response.data && (err.response.data.error && err.response.data.error.message || err.response.data.message) || err.response.statusText || err.message);
      throw createError(status >= 500 ? 502 : (status || 502), `OpenAI translation failed: ${message || 'upstream request failed'}`);
    }
    throw createError(503, `OpenAI translation failed: ${err.message}`);
  }
  const text = Utils.trimToEmpty(response.data?.choices?.[0]?.message?.content);
  if (!text)
    throw createError(502, 'OpenAI translation returned an empty response.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    debug.error(`content translation parse failed mode=${mode} type=${source.itemType} id=${source.itemId} lang=${targetLanguage.code} model=${model} responseLength=${text.length}: ${err.message}\n${err.stack || ''}`);
    throw createError(502, 'OpenAI translation returned an invalid response.');
  }
  return {
    model,
    content: normalizeModelContent(source.fields, parsed)
  };
}

async function available(itemType, itemId) {
  assertEnabled();
  await UserPoints.ensureTables();
  await PaymentConfig.loadLanguages();
  const source = await loadSource(itemType, itemId);
  const sourceHash = translationCacheHash(source);
  const translations = [];
  const seen = new Set();
  const add = (option) => {
    if (!option || seen.has(option.code))
      return;
    seen.add(option.code);
    translations.push(option);
  };
  add(translationOption('en', source.languages && source.languages.en, 'source'));
  const saved = await UserPoints.availableContentTranslations(source.itemType, source.itemId, sourceHash);
  saved.forEach(row => {
    add(translationOption(row.targetLanguage, row.content, 'translation'));
  });
  return {
    itemType: source.itemType,
    itemId: source.itemId,
    reference: source.ref,
    sourceHash,
    translations
  };
}

async function estimate(user, itemType, itemId, targetLanguage, mode) {
  assertEnabled();
  await UserPoints.ensureTables();
  await PaymentConfig.loadLanguages();
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

async function translate(user, itemType, itemId, targetLanguage, mode, options) {
  assertEnabled();
  options = options || {};
  user = await UserPoints.ensureUser(user);
  await PaymentConfig.loadLanguages();
  mode = normalizeMode(mode);
  targetLanguage = normalizeLanguage(targetLanguage, { allowArabicFix: mode === 'fix' });
  const source = await loadSource(itemType, itemId);
  const taskSource = sourceForTask(source, targetLanguage, mode);
  const hash = translationCacheHash(taskSource);
  const useHadithRevision = shouldUseHadithRevision(user, source, targetLanguage, mode);
  const existingFree = useHadithRevision ? null : freeExistingContent(source, targetLanguage, mode);
  const checkoutSessionId = Utils.trimToEmpty(options.checkoutSessionId);
  const expectedCheckout = checkoutExpected(source, targetLanguage, mode);
  if (existingFree) {
    await cancelCheckoutSilently(user, checkoutSessionId, expectedCheckout, 'existing-free');
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
    await cancelCheckoutSilently(user, checkoutSessionId, expectedCheckout, 'cached');
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
  const metadata = {
    itemType: source.itemType,
    itemId: source.itemId,
    targetLanguage: targetLanguage.code,
    mode,
    ref: source.ref
  };
  let shouldCaptureCheckout = false;
  if (points > 0) {
    const currentBalance = await UserPoints.balance(user);
    if (checkoutSessionId) {
      const authorization = await Payments.validateContentTranslationCheckout(user, checkoutSessionId, expectedCheckout);
      if (currentBalance + Number(authorization.points || 0) < points) {
        await cancelCheckoutSilently(user, checkoutSessionId, expectedCheckout, 'insufficient-authorized-points');
        throw createError(402, 'Not enough points. Choose a point package that covers this translation.');
      }
      shouldCaptureCheckout = true;
    } else if (currentBalance < points) {
      throw createError(402, 'Not enough points. Buy more points from My Settings.');
    }
  } else {
    await cancelCheckoutSilently(user, checkoutSessionId, expectedCheckout, 'zero-point-translation');
  }
  let generated;
  try {
    generated = useHadithRevision ? await requestHadithRevision(source, user) : await requestModel(taskSource, targetLanguage, mode);
  } catch (err) {
    await cancelCheckoutSilently(user, checkoutSessionId, expectedCheckout, 'translation-error');
    throw err;
  }
  let payment = null;
  if (shouldCaptureCheckout)
    payment = await Payments.captureContentTranslationCheckout(user, checkoutSessionId, expectedCheckout);
  const saved = await UserPoints.debitAndSaveContentTranslation(user, source.itemType, source.itemId, targetLanguage.code, mode, hash, generated.content, generated.model, points, 'content_translation', 'content_translation', debitReference, metadata);
  return {
    content: generated.content,
    points,
    balance: saved.debit.balance,
    cached: false,
    payment,
    sourceUpdated: generated.sourceUpdated === true,
    indexed: generated.indexed === true,
    targetLanguage,
    reference: source.ref
  };
}

module.exports = {
  available,
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
