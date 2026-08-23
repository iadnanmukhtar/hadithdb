'use strict';

const debug = require('../lib/Debug')('hadithdb:Proxy');
const express = require('express');
const createError = require('http-errors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const markdownitFootnote = require('markdown-it-footnote');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const Books = require('../lib/Books');
const ContentTranslations = require('../lib/ContentTranslations');
const PaymentConfig = require('../lib/PaymentConfig');
const QuranRecitations = require('../lib/QuranRecitations');

const router = express.Router();
const GENERIC_PROXY_ALLOWED_HOSTS = new Set(
  (process.env.GENERIC_PROXY_ALLOWED_HOSTS || 'masjidal.com')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);
const GENERIC_PROXY_TIMEOUT_MS = 10000;
const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
const quranBacktickMd = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
quranBacktickMd.renderer.rules.code_inline = renderQuranBacktickToken;
quranBacktickMd.renderer.rules.code_block = renderQuranBacktickBlock;
quranBacktickMd.renderer.rules.fence = renderQuranBacktickBlock;

function setApiNoIndex(res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

function setStableProxyCache(req, res) {
  setApiNoIndex(res);
  if (req.query && 'flush' in req.query)
    res.setHeader('Cache-Control', 'no-store');
}

function setPrivateProxyCache(res) {
  setApiNoIndex(res);
  res.setHeader('Cache-Control', 'no-store');
}

function setPublicProxyContentCache(req, res, isPrivate) {
  if (isPrivate || (req.query && 'flush' in req.query))
    setPrivateProxyCache(res);
  else
    setStableProxyCache(req, res);
}

router.use(function noIndexProxyResponses(req, res, next) {
  setApiNoIndex(res);
  next();
});

function validQuranRange(surah, ayahFrom, ayahTo, allowZero) {
  const surahInfo = (global.surahs || []).find(item => Number(item.num) === Number(surah));
  const ayahCount = Number(surahInfo && (surahInfo.ayahs || surahInfo.ayat));
  const minAyah = allowZero ? 0 : 1;
  return !!surahInfo
    && Number.isInteger(ayahFrom)
    && Number.isInteger(ayahTo)
    && ayahFrom >= minAyah
    && ayahTo >= ayahFrom
    && ayahTo <= ayahCount;
}

router.get('/quran-audio/recitations', async function (req, res) {
  setStableProxyCache(req, res);
  res.json({
    recitations: await QuranRecitations.list()
  });
});

router.get('/quran-audio/passage', async function (req, res) {
  const surah = Number(req.query.s);
  const ayahFrom = Number(req.query.from);
  const ayahTo = req.query.to === undefined ? ayahFrom : Number(req.query.to);
  const reciter = (req.query.reciter || req.query.recitation_id || req.query.recitationId || 'juhani').toString();
  if (!/^[A-Za-z0-9_-]+$/.test(reciter) || !Number.isInteger(surah) || !Number.isInteger(ayahFrom) || !Number.isInteger(ayahTo) ||
      !validQuranRange(surah, ayahFrom, ayahTo, false)) {
    res.status(400).json({ error: 'Invalid Quran audio request.' });
    return;
  }

  const audio = await QuranRecitations.passage(reciter, surah, ayahFrom, ayahTo);
  if (audio.length < 1) {
    res.status(404).json({ error: 'No Quran audio is available for this passage.' });
    return;
  }
  setStableProxyCache(req, res);
  res.json({
    reciter: reciter,
    surah: surah,
    from: ayahFrom,
    to: ayahTo,
    audio: audio,
    missing: []
  });
});

router.get('/tafsir/books', async function (req, res) {
  debug('proxy tafsir books start');
  const rows = await Tafsir.visibleTafsirs();
  debug(`proxy tafsir books done rows=${rows.length}`);
  setStableProxyCache(req, res);
  res.json(rows);
});

router.get('/translations/books', async function (req, res) {
  debug('proxy translations books start');
  const rows = await Tafsir.visibleTranslations();
  debug(`proxy translations books done rows=${rows.length}`);
  setStableProxyCache(req, res);
  res.json(rows);
});

router.get('/translations/local', async function (req, res) {
  const aliases = uniqueAliases((req.query.src || '').toString().split(','));
  const surah = Number(req.query.s);
  const ayah = req.query.a === undefined ? NaN : Number(req.query.a);
  const ayahFrom = req.query.from === undefined ? ayah : Number(req.query.from);
  const ayahTo = req.query.to === undefined ? ayahFrom : Number(req.query.to);
  const lang = (req.query.lang || 'en').toString();
  if (aliases.length < 1 || aliases.length > 100 ||
      !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayahFrom) || ayahFrom < 0 || !Number.isInteger(ayahTo) || ayahTo < ayahFrom ||
      !validQuranRange(surah, ayahFrom, ayahTo, true) ||
      (lang && lang !== 'ar' && lang !== 'en')) {
    res.status(400).json({ error: 'Invalid local translation request.' });
    return;
  }
  debug(`proxy local translations start aliases=${aliases.join(',')} ref=${surah}:${ayahFrom}-${ayahTo} lang=${lang || ''}`);
  const rows = await localCommentaryRowsForAliases(aliases, surah, ayahFrom, ayahTo);
  debug(`proxy local translations rows=${rows.length} aliases=${aliases.join(',')} ref=${surah}:${ayahFrom}-${ayahTo}`);
  const editMode = isEditMode(req);
  if (editMode)
    aliases.forEach(alias => addMissingEditableCommentaryRows(rows, alias, surah, ayahFrom, ayahTo));
  const renderEditableContent = editMode && (req.query.render || '').toString() !== 'reader';
  const entries = rows.map(row => {
    const alias = row.commentary_alias;
    const editLang = lang === 'ar' ? 'ar' : 'en';
    const editSuffix = editLang === 'en' ? '_en' : '';
    const html = renderLocalCommentary(row, renderEditableContent, lang, alias);
    return {
      alias: alias,
      ordinal: Number(row.ordinal || 0),
      ayahs_start: row.ayahFrom,
      count: row.ayahTo - row.ayahFrom,
      bilingual: commentaryRowHasBothLanguages(row),
      html: html,
      ...(editMode ? {
        edit: {
          id: row.id,
          lang: editLang,
          format: commentaryFormat(row.format, editLang),
          text: row[`text${editSuffix}`] || '',
          text_prop: `commentary.text${editSuffix}`,
          footnotes: row[`footnotes${editSuffix}`] || '',
          footnotes_prop: `commentary.footnotes${editSuffix}`
        }
      } : {})
    };
  }).filter(entry => entry.alias && (!lang || entry.html || Number.isInteger(Number(entry.ayahs_start))));
  setPublicProxyContentCache(req, res, editMode);
  res.json({ entries: entries });
});

router.get('/tafsir/local', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = req.query.a === undefined ? NaN : Number(req.query.a);
  const ayahFrom = req.query.from === undefined ? ayah : Number(req.query.from);
  const ayahTo = req.query.to === undefined ? ayahFrom : Number(req.query.to);
  const lang = (req.query.lang || '').toString();
  if (!/^[A-Za-z0-9_-]+$/.test(src) || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayahFrom) || ayahFrom < 0 || !Number.isInteger(ayahTo) || ayahTo < ayahFrom ||
      !validQuranRange(surah, ayahFrom, ayahTo, true) ||
      (lang && lang !== 'ar' && lang !== 'en')) {
    res.status(400).json({ error: 'Invalid local tafsir request.' });
    return;
  }
  debug(`proxy local tafsir start alias=${src} ref=${surah}:${ayahFrom}-${ayahTo} lang=${lang || ''}`);
  const rows = await localCommentaryRowsFromIndex(src, surah, ayahFrom, ayahTo);
  debug(`proxy local tafsir rows=${rows.length} alias=${src} ref=${surah}:${ayahFrom}-${ayahTo}`);
  const editMode = isEditMode(req);
  if (editMode)
    addMissingEditableCommentaryRows(rows, src, surah, ayahFrom, ayahTo);
  if (!rows.length) {
    res.status(404).json({ error: 'No local tafsir text is available for this ayah.' });
    return;
  }
  const tafsirTranslationsEnabled = PaymentConfig.contentTranslationEnabledForItemType('tafsir');
  const entries = rows.map(row => {
    const translationEstimate = tafsirTranslationsEnabled ? localCommentaryTranslationEstimate(row) : null;
    const rendered = renderLocalCommentaryResult(row, editMode, lang, src);
    return {
      id: row.id,
      ayahs_start: row.ayahFrom,
      count: row.ayahTo - row.ayahFrom,
      bilingual: rendered.bilingual,
      ...(rendered.contentTranslationLanguage ? { content_translation_language: rendered.contentTranslationLanguage } : {}),
      ...(rendered.arabicHtml ? { arabic_html: rendered.arabicHtml } : {}),
      ...(translationEstimate ? {
        translation_points: translationEstimate.points,
        translation_word_count: translationEstimate.wordCount,
        translation_existing: localCommentaryTranslationExisting(row, lang)
      } : {}),
      html: rendered.html
    };
  }).filter(entry => editMode || entry.html);
  if (!entries.length) {
    res.status(404).json({ error: 'No local tafsir text is available for this ayah.' });
    return;
  }
  setPublicProxyContentCache(req, res, editMode);
  if (req.query.from !== undefined || req.query.to !== undefined)
    res.json({ entries: entries });
  else
    res.json(entries[0]);
});

router.get('/tafsir', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = Number(req.query.a);
  const version = Number(req.query.ver || 1);
  if (!global.tafsirAppAliases.has(src) || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayah) || ayah < 0 || !validQuranRange(surah, ayah, ayah, true) || !Number.isInteger(version) || version < 1) {
    res.status(400).json({ error: 'Invalid tafsir request.' });
    return;
  }

  try {
    const t0 = Date.now();
    debug(`proxy tafsir.app start alias=${src} ref=${surah}:${ayah} version=${version}`);
    const response = await axios.get('https://tafsir.app/get.php', {
      params: {
        src: src,
        s: surah,
        a: ayah,
        ver: version
      },
      timeout: 10000
    });
    const elapsedMs = Date.now() - t0;
    debug(`proxy tafsir.app done alias=${src} ref=${surah}:${ayah} status=${response.status} elapsedMs=${elapsedMs}`);
    debug.slow('tafsir.app proxy', elapsedMs, `alias=${src} ref=${surah}:${ayah} status=${response.status}`);
    if (response.data && response.data.data)
      response.data.data = Tafsir.stripPageMarkers(response.data.data);
    setPublicProxyContentCache(req, res, false);
    res.json(response.data);
  } catch (err) {
    debug.error(`tafsir.app unavailable for ${src} ${surah}:${ayah}: ${err.message}\n${err.stack || ''}`);
    setPrivateProxyCache(res);
    res.status(503).json({ error: 'Remote tafsir service is unavailable. Please use a local tafsir.' });
  }
});

router.get('/:url', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  debug(`Proxy: ${req.params.url}`);
  try {
    var resource;
    var text;
    var url = new URL(req.params.url);
    if (url.protocol !== 'https:')
      return next(createError(400, `Invalid route parameter 'url=${req.params.url}': proxy URL must use https`));
    if (!isAllowedGenericProxyHost(url.hostname))
      return next(createError(403, `Proxy host is not allowed`));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERIC_PROXY_TIMEOUT_MS);
    try {
      const t0 = Date.now();
      debug(`generic proxy fetch start ${url.toString()}`);
      resource = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'accept': req.get('accept') || '*/*',
          'user-agent': 'hadithdb-proxy/1.0'
        }
      });
      text = await resource.text();
      const elapsedMs = Date.now() - t0;
      debug(`generic proxy fetch done ${url.toString()} status=${resource.status} elapsedMs=${elapsedMs}`);
      debug.slow('generic proxy fetch', elapsedMs, `${url.toString()} status=${resource.status}`);
    } catch (e) {
      debug.error(`generic proxy fetch failed ${url.toString()}: ${e.message}\n${e.stack || ''}`);
      return next(createError(502, 'Proxy fetch failed'));
    } finally {
      clearTimeout(timeout);
    }
    res.status(resource.status);
    setPrivateProxyCache(res);
    const contentType = resource.headers.get('content-type');
    if (contentType)
      res.setHeader('Content-Type', contentType);
    res.send(text);
    return;
  } catch (e) {
    debug.error(`Proxy: ${req.params.url} ${e.message || e}\n${e.stack || ''}`);
    return next(createError(400, `Invalid route parameter 'url=${req.params.url}': proxy URL must be absolute`));
  }
});

function isAllowedGenericProxyHost(hostname) {
  hostname = (hostname || '').toLowerCase();
  if (!hostname || GENERIC_PROXY_ALLOWED_HOSTS.size === 0)
    return false;
  for (const allowed of GENERIC_PROXY_ALLOWED_HOSTS) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`))
      return true;
  }
  return false;
}

async function localCommentaryRowsFromIndex(src, surah, ayahFrom, ayahTo) {
  const size = Math.min(1000, Math.max(1, ayahTo - ayahFrom + 21));
  const rows = await Index.docsFromQuery('commentaries', {
    bool: {
      filter: [
        { term: { doctype: 'commentary' } },
        { term: { commentary_alias: src } },
        { term: { source: 'local' } },
        { term: { surah: surah } },
        { range: { ayahFrom: { lte: ayahTo } } },
        { range: { ayahTo: { gte: ayahFrom } } }
      ]
    }
  }, 0, size, 'ayahFrom ASC, ayahTo ASC', false);
  return rows.map(row => ({
    ...row,
    format: row.format,
    id: row.id,
    surah: Number(row.surah),
    ayahFrom: Number(row.ayahFrom),
    ayahTo: Number(row.ayahTo),
    text: row.text,
    text_en: row.text_en,
    footnotes: row.footnotes,
    footnotes_en: row.footnotes_en
  }));
}

async function localCommentaryRowsForAliases(aliases, surah, ayahFrom, ayahTo) {
  const size = Math.min(5000, Math.max(1, aliases.length * Math.max(1, ayahTo - ayahFrom + 21)));
  let rows;
  try {
    rows = await localCommentaryRowsForAliasesFromIndex(aliases, surah, ayahFrom, ayahTo, size);
  } catch (err) {
    debug.error(`local translations index failed aliases=${aliases.join(',')} ref=${surah}:${ayahFrom}-${ayahTo}: ${err.message}\n${err.stack || ''}`);
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await localCommentaryRowsForAliasesFromDb(aliases, surah, ayahFrom, ayahTo, size);
  }
  if (rows.length < aliases.length && typeof global.query === 'function')
    rows = await localCommentaryRowsForAliasesFromDb(aliases, surah, ayahFrom, ayahTo, size);
  return rows;
}

async function localCommentaryRowsForAliasesFromIndex(aliases, surah, ayahFrom, ayahTo, size) {
  const rows = await Index.docsFromQueryFields('commentaries', {
    bool: {
      filter: [
        { term: { doctype: 'commentary' } },
        { terms: { commentary_alias: aliases } },
        { term: { source: 'local' } },
        { term: { surah: surah } },
        { range: { ayahFrom: { lte: ayahTo } } },
        { range: { ayahTo: { gte: ayahFrom } } }
      ]
    }
  }, localCommentaryIndexFields([
    'commentary_alias',
    'ordinal',
    'format',
    'id',
    'surah',
    'ayahFrom',
    'ayahTo',
    'text',
    'text_en',
    'footnotes',
    'footnotes_en'
  ]), 0, size, 'commentary_alias ASC, ayahFrom ASC, ayahTo ASC', false);
  return rows.map(row => ({
    ...row,
    commentary_alias: row.commentary_alias,
    ordinal: Number(row.ordinal || 0),
    format: row.format,
    id: row.id,
    surah: Number(row.surah),
    ayahFrom: Number(row.ayahFrom),
    ayahTo: Number(row.ayahTo),
    text: row.text,
    text_en: row.text_en,
    footnotes: row.footnotes,
    footnotes_en: row.footnotes_en
  }));
}

function localCommentaryIndexFields(baseFields) {
  const fields = new Set(baseFields || []);
  PaymentConfig.supportedLanguages().forEach(language => {
    const code = normalizeTranslationLanguageCode(language && language.code);
    if (!code || code === 'ar' || code === 'en')
      return;
    fields.add(`text_${code}`);
    fields.add(`footnote_${code}`);
  });
  return Array.from(fields);
}

async function localCommentaryRowsForAliasesFromDb(aliases, surah, ayahFrom, ayahTo, size) {
  const escapedAliases = aliases.map(alias => global.dbPool.escape(alias)).join(',');
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  const rows = await global.query(`
    SELECT
      bc.alias AS commentary_alias,
      bc.ordinal,
      bc.format,
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
    WHERE bc.source='local'
      AND bc.hidden=0
      AND ${commentaryJoin.typePredicate}
      AND bc.alias IN (${escapedAliases})
      AND hc.surah=${Number(surah)}
      AND hc.ayahFrom<=${Number(ayahTo)}
      AND hc.ayahTo>=${Number(ayahFrom)}
    ORDER BY bc.ordinal ASC, bc.alias ASC, hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT ${Number(size)}`);
  return rows.map(row => ({
    commentary_alias: row.commentary_alias,
    ordinal: Number(row.ordinal || 0),
    format: row.format,
    id: row.id,
    surah: Number(row.surah),
    ayahFrom: Number(row.ayahFrom),
    ayahTo: Number(row.ayahTo),
    text: row.text,
    text_en: row.text_en,
    footnotes: row.footnotes,
    footnotes_en: row.footnotes_en
  }));
}

function uniqueAliases(values) {
  return Array.from(new Set((values || [])
    .map(value => (value || '').toString().trim())
    .filter(value => /^[A-Za-z0-9_-]+$/.test(value))));
}

function isSearchBackendUnavailable(err) {
  const status = err && (err.status || err.statusCode);
  return [502, 503, 504].includes(Number(status));
}

function addMissingEditableCommentaryRows(rows, src, surah, ayahFrom, ayahTo) {
  const catalogRows = global.commentariesByAlias && global.commentariesByAlias.get(src);
  const book = (catalogRows || []).find(row => row.source === 'local' && Number(row.hidden) === 0);
  if (!book)
    return;
  const coveredAyahs = new Set();
  rows.filter(row => !row.commentary_alias || row.commentary_alias === src).forEach(row => {
    for (let ayah = row.ayahFrom; ayah <= row.ayahTo; ayah++)
      coveredAyahs.add(ayah);
  });
  for (let ayah = ayahFrom; ayah <= ayahTo; ayah++) {
    if (coveredAyahs.has(ayah))
      continue;
    rows.push({
      commentary_alias: src,
      format: book.format || 'md',
      id: newCommentaryId(src, surah, ayah, ayah),
      surah: surah,
      ayahFrom: ayah,
      ayahTo: ayah,
      text: '',
      text_en: '',
      footnotes: '',
      footnotes_en: ''
    });
  }
  rows.sort((a, b) => a.ayahFrom - b.ayahFrom || a.ayahTo - b.ayahTo);
}

function newCommentaryId(src, surah, ayahFrom, ayahTo) {
  return ['new-commentary', src, surah, ayahFrom, ayahTo].join(',');
}

function renderLocalCommentary(row, editMode, lang, src) {
  return renderLocalCommentaryResult(row, editMode, lang, src).html;
}

function renderLocalCommentaryResult(row, editMode, lang, src) {
  lang = normalizeTranslationLanguageCode(lang);
  if (lang === 'en' && !commentaryRowHasBothLanguages(row)) {
    const html = renderLocalCommentaryLanguage(row, editMode, 'en', src);
    return {
      html: html,
      bilingual: false,
      contentTranslationLanguage: html ? 'en' : ''
    };
  }
  const translation = localCommentaryAvailableTranslation(row, lang === 'ar' ? 'en' : lang || 'en');
  if (commentaryRowHasLanguage(row, 'ar') && translation) {
    const arabicHtml = renderLocalCommentaryArabicContent(row, editMode, src);
    const translationHtml = renderLocalCommentaryTranslationContent(row, editMode, translation, src);
    if (arabicHtml && translationHtml) {
      return {
        html: renderLocalCommentaryPair(arabicHtml, translationHtml, translation),
        bilingual: true,
        contentTranslationLanguage: translation.code,
        arabicHtml: arabicHtml
      };
    }
  }
  if (lang === 'ar') {
    const html = renderLocalCommentaryLanguage(row, editMode, 'ar', src);
    return {
      html: html,
      bilingual: false,
      contentTranslationLanguage: html ? 'en' : '',
      arabicHtml: html ? renderLocalCommentaryArabicContent(row, editMode, src) : ''
    };
  }
  const footnoteIdPrefix = commentaryFootnoteIdPrefix(src, row.id);
  const arabic = renderLocalCommentaryArabicContent(row, editMode, src);
  const english = editMode
    ? renderEditableCommentaryLanguage(row, 'en', src)
    : renderCommentaryText(row.text_en, row.footnotes_en, commentaryFormat(row.format, 'en'), { footnoteIdPrefix: footnoteIdPrefix, quranBackticks: true });
  if (arabic && english) {
    return {
      html: renderLocalCommentaryPair(arabic, english, localCommentaryLanguageMetadata('en')),
      bilingual: true,
      contentTranslationLanguage: 'en',
      arabicHtml: arabic
    };
  }
  const sections = [];
  if (arabic)
    sections.push(`<section lang="ar" dir="rtl">${arabic}</section>`);
  if (english)
    sections.push(`<section lang="en">${english}</section>`);
  return {
    html: sections.join('\n'),
    bilingual: false,
    contentTranslationLanguage: english ? 'en' : (arabic ? 'en' : ''),
    arabicHtml: arabic || ''
  };
}

function commentaryRowHasLanguage(row, lang) {
  if (lang === 'en')
    return trimToEmpty(row && (row.text_en || row.footnotes_en)) !== '';
  if (lang === 'ar')
    return trimToEmpty(row && (row.text || row.footnotes)) !== '';
  return false;
}

function commentaryRowHasBothLanguages(row) {
  return commentaryRowHasLanguage(row, 'ar') && commentaryRowHasLanguage(row, 'en');
}

function commentaryRowGeneratedTranslationCodes(row) {
  const seen = new Set();
  Object.keys(row || {}).forEach(key => {
    const match = key.match(/^(?:text|footnote)_([a-z][a-z0-9]{1,15})$/);
    const code = normalizeTranslationLanguageCode(match && match[1]);
    if (!code || code === 'ar' || code === 'en' || seen.has(code))
      return;
    if (trimToEmpty(row[`text_${code}`]) || trimToEmpty(row[`footnote_${code}`]))
      seen.add(code);
  });
  return Array.from(seen).sort();
}

function localCommentaryAvailableTranslation(row, preferredLang) {
  const codes = [];
  const seen = new Set();
  const add = code => {
    code = normalizeTranslationLanguageCode(code);
    if (!code || code === 'ar' || seen.has(code))
      return;
    seen.add(code);
    codes.push(code);
  };
  add(preferredLang);
  add('en');
  commentaryRowGeneratedTranslationCodes(row).forEach(add);
  for (const code of codes) {
    const fields = localCommentaryLanguageFields(row, code);
    if (trimToEmpty(fields.text) || trimToEmpty(fields.footnotes))
      return {
        ...localCommentaryLanguageMetadata(code),
        text: fields.text,
        footnotes: fields.footnotes
      };
  }
  return null;
}

function localCommentaryLanguageFields(row, code) {
  code = normalizeTranslationLanguageCode(code);
  if (code === 'en') {
    return {
      text: row && row.text_en,
      footnotes: row && row.footnotes_en
    };
  }
  return {
    text: row && row[`text_${code}`],
    footnotes: row && row[`footnote_${code}`]
  };
}

function localCommentaryLanguageMetadata(code) {
  code = normalizeTranslationLanguageCode(code);
  const language = PaymentConfig.languageMetadata(code) || {};
  return {
    code: code,
    dir: language.dir === 'rtl' ? 'rtl' : 'ltr',
    fontClass: language.fontClass || ''
  };
}

function normalizeTranslationLanguageCode(code) {
  code = trimToEmpty(code).toLowerCase();
  return /^[a-z][a-z0-9]{1,15}$/.test(code) ? code : '';
}

function localCommentaryTranslationFields(row) {
  return {
    text: trimToEmpty(row && row.text) || trimToEmpty(row && row.text_en),
    footnotes: trimToEmpty(row && row.footnotes) || trimToEmpty(row && row.footnotes_en)
  };
}

function localCommentaryTranslationEstimate(row) {
  return ContentTranslations.estimateFields(localCommentaryTranslationFields(row), 'translate');
}

function localCommentaryTranslationExisting(row, lang) {
  lang = normalizeTranslationLanguageCode(lang);
  if (lang === 'ar')
    return !!localCommentaryAvailableTranslation(row, 'en');
  if (lang === 'en')
    return commentaryRowHasLanguage(row, 'en');
  return !!localCommentaryAvailableTranslation(row, lang || 'en');
}

function trimToEmpty(value) {
  return (value || '').toString().trim();
}

function renderLocalCommentaryLanguage(row, editMode, lang, src) {
  const content = editMode
    ? renderEditableCommentaryLanguage(row, lang, src)
    : renderCommentaryText(
      lang === 'en' ? row.text_en : row.text,
      lang === 'en' ? row.footnotes_en : row.footnotes,
      commentaryFormat(row.format, lang),
      { bracketedFootnotes: lang === 'ar', footnoteIdPrefix: commentaryFootnoteIdPrefix(src, row.id), quranBackticks: lang === 'en' }
    );
  if (!content)
    return '';
  if (lang === 'ar') {
    const translation = editMode ? renderCollapsedEditableTranslation(row, src) : '';
    return `<section lang="ar" dir="rtl">${content}</section>${translation}`;
  }
  return `<section lang="en">${content}</section>`;
}

function renderLocalCommentaryArabicContent(row, editMode, src) {
  return editMode
    ? renderEditableCommentaryLanguage(row, 'ar', src)
    : renderCommentaryText(
      row.text,
      row.footnotes,
      commentaryFormat(row.format, 'ar'),
      { bracketedFootnotes: true, footnoteIdPrefix: commentaryFootnoteIdPrefix(src, row.id) }
    );
}

function renderLocalCommentaryTranslationContent(row, editMode, translation, src) {
  if (!translation)
    return '';
  if (translation.code === 'en' && editMode)
    return renderEditableCommentaryLanguage(row, 'en', src);
  return renderCommentaryText(
    translation.text,
    translation.footnotes,
    commentaryFormat(row.format, 'en'),
    {
      footnoteIdPrefix: commentaryFootnoteIdPrefix(src, `${row.id}-${translation.code}`),
      quranBackticks: true,
      markArabicOnlyBlocks: translation.code === 'en'
    }
  );
}

function renderLocalCommentaryPair(arabicHtml, translationHtml, translation) {
  const lang = escapeHtml((translation && translation.code) || 'en');
  const dir = translation && translation.dir === 'rtl' ? 'rtl' : 'ltr';
  const fontClass = trimToEmpty(translation && translation.fontClass).replace(/[^A-Za-z0-9_-]+/g, ' ');
  const classes = ['col-md-6 col-sm-12', fontClass].filter(Boolean).join(' ');
  return `<div class="row quran-tafsir-local-pair"><section class="${escapeHtml(classes)}" lang="${lang}" dir="${dir}">${translationHtml}</section><section class="col-md-6 col-sm-12" lang="ar" dir="rtl">${arabicHtml}</section></div>`;
}

function renderCollapsedEditableTranslation(row, src) {
  const english = renderEditableCommentaryLanguage(row, 'en', src);
  if (!english)
    return '';
  return `<details class="quran-tafsir-translation-editor" lang="en" dir="ltr"><summary>English translation</summary>${english}</details>`;
}

function renderEditableCommentaryLanguage(row, lang, src) {
  const suffix = lang === 'en' ? '_en' : '';
  const format = commentaryFormat(row.format, lang);
  const text = row[`text${suffix}`];
  const footnotes = row[`footnotes${suffix}`];
  return [
    renderEditableCommentaryField(row.id, `text${suffix}`, text, format, lang, src, footnotes),
    renderEditableCommentaryField(row.id, `footnotes${suffix}`, footnotes, format, lang, src)
  ].join('\n');
}

function renderEditableCommentaryField(id, column, text, format, lang, src, previewFootnotes = '') {
  const value = text || '';
  const placeholder = commentaryFieldPlaceholder(column, lang);
  const escapedPlaceholder = escapeHtml(placeholder);
  const attrs = `class="_e quran-tafsir-editor${format === 'md' ? '' : ' form-control'}" data-id="${id}" data-prop="commentary.${column}" data-edit-format="${format}" data-edit-lang="${lang}" data-placeholder="${escapedPlaceholder}"`;
  if (format === 'md' && column.startsWith('footnotes')) {
    const count = Array.from(value.matchAll(/^\[\^[^\]]+\]:/gm)).length;
    const label = lang === 'ar' ? `تحرير الحواشي (${count})` : `Edit footnotes (${count})`;
    return `<div ${attrs} data-markdown-source="${escapeHtml(value)}" data-markdown-empty-html="${escapedPlaceholder}"><span class="quran-tafsir-footnotes-edit-label">${escapeHtml(label)}</span></div>`;
  }
  if (format === 'md')
    return `<div ${attrs} data-markdown-source="${escapeHtml(value)}" data-markdown-empty-html="${escapedPlaceholder}">${renderCommentaryText(value, previewFootnotes, format, { bracketedFootnotes: lang === 'ar', footnoteIdPrefix: commentaryFootnoteIdPrefix(src, id), quranBackticks: lang === 'en' }) || escapedPlaceholder}</div>`;
  return `<textarea ${attrs} rows="12" placeholder="${escapedPlaceholder}">${escapeHtml(value)}</textarea>`;
}

function commentaryFieldPlaceholder(column, lang) {
  const isFootnotes = column.startsWith('footnotes');
  if (lang === 'ar')
    return isFootnotes ? 'أدخل حواشي التفسير' : 'أدخل نص التفسير';
  return isFootnotes ? 'Enter tafsir footnotes' : 'Enter tafsir text';
}

function commentaryFormat(format, lang) {
  const formats = (format || 'md').split(',').map(value => value.trim()).filter(Boolean);
  const languageFormat = formats.find(value => value.startsWith(`${lang}:`));
  if (languageFormat)
    return languageFormat.slice(lang.length + 1);
  const defaultFormat = formats.find(value => !value.includes(':'));
  return defaultFormat || 'md';
}

function renderCommentaryText(text, footnotes, format, options = {}) {
  if (!text)
    return '';
  const renderedFootnotes = format === 'md' ? Tafsir.prepareMarkdownFootnotesForRendering(footnotes) : footnotes;
  let content = [text, renderedFootnotes].filter(Boolean).map(Tafsir.stripPageMarkers).join('\n\n');
  if (options.bracketedFootnotes)
    content = bracketedFootnotesToMarkdown(content);
  if (format === 'html')
    return maybeMarkArabicOnlyBlocks(namespaceFootnoteIds(content, options.footnoteIdPrefix), options);
  const renderer = options.quranBackticks ? quranBacktickMd : md;
  const html = renderer.render(content).replace(/<br>/g, '</p><p>');
  return maybeMarkArabicOnlyBlocks(namespaceFootnoteIds(html, options.footnoteIdPrefix), options);
}

function maybeMarkArabicOnlyBlocks(html, options) {
  if (options && options.markArabicOnlyBlocks === false)
    return html;
  return markArabicOnlyBlocks(html);
}

function renderQuranBacktickToken(tokens, idx) {
  return quranBacktickSpan(tokens[idx].content);
}

function renderQuranBacktickBlock(tokens, idx) {
  const content = (tokens[idx].content || '').replace(/\n+$/g, '');
  if (!content)
    return '';
  return `<p>${content.split(/\n+/).map(quranBacktickSpan).join('<br>')}</p>\n`;
}

function quranBacktickSpan(text) {
  return `<span class="quran-tafsir-backtick quran-hafs" lang="ar" dir="rtl">${md.utils.escapeHtml(text)}</span>`;
}

function bracketedFootnotesToMarkdown(content) {
  const notes = [];
  const text = (content || '').replace(/(?:\\\[|\[)(?:\\\[|\[)([\s\S]*?)(?:\\\]|\])(?:\\\]|\])/g, function (match, note) {
    note = note.trim();
    if (!note)
      return '';
    notes.push(note);
    return `[^${notes.length}]`;
  });
  if (!notes.length)
    return text;
  return [
    text.trimEnd(),
    notes.map((note, index) => `[^${index + 1}]: ${markdownFootnoteDefinition(note)}`).join('\n')
  ].join('\n\n');
}

function markdownFootnoteDefinition(note) {
  return note.replace(/\r\n?/g, '\n').split('\n').map((line, index) => {
    return index === 0 ? line : `    ${line}`;
  }).join('\n');
}

function commentaryFootnoteIdPrefix(alias, id) {
  const source = [alias, id].filter(Boolean).join('-');
  return `tafsir-${source}`.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function namespaceFootnoteIds(html, prefix) {
  if (!prefix)
    return html;
  const $ = cheerio.load(html, null, false);
  const namespaceId = id => {
    if (!id || id.startsWith(`${prefix}-`))
      return id;
    return `${prefix}-${id}`;
  };
  $('[id^="fn"]').each(function () {
    const element = $(this);
    element.attr('id', namespaceId(element.attr('id')));
  });
  $('a[href^="#fn"]').each(function () {
    const element = $(this);
    const href = element.attr('href') || '';
    element.attr('href', `#${namespaceId(href.slice(1))}`);
  });
  return $.html();
}

function markArabicOnlyBlocks(html) {
  const $ = cheerio.load(html, null, false);
  $('p, li, blockquote, h1, h2, h3, h4, h5, h6').each(function () {
    const element = $(this);
    const text = element.text();
    if (/\p{Script=Arabic}/u.test(text) && !/[A-Za-z]/.test(text))
      element.addClass('quran-tafsir-arabic-only').attr({ lang: 'ar', dir: 'rtl' });
  });
  return $.html();
}

function isEditMode(req) {
  return req.admin && req.editMode;
}

function escapeHtml(text) {
  return (text || '').toString().replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

module.exports = router;
