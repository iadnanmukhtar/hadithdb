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

const router = express.Router();
const GENERIC_PROXY_ALLOWED_HOSTS = new Set(
  (process.env.GENERIC_PROXY_ALLOWED_HOSTS || 'masjidal.com')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);
const GENERIC_PROXY_TIMEOUT_MS = 10000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const LOCAL_QURAN_AUDIO_RECITERS = Object.freeze([
  Object.freeze({
    id: 'juhani',
    slug: 'juhani',
    aliases: Object.freeze(['johani', 'juhani', '7']),
    shortName: 'Juhani',
    reciter_name: 'Abdullaah Awwad al-Juhani',
    label: 'Juhani'
  })
]);
const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
const quranBacktickMd = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
quranBacktickMd.renderer.rules.code_inline = renderQuranBacktickToken;
quranBacktickMd.renderer.rules.code_block = renderQuranBacktickBlock;
quranBacktickMd.renderer.rules.fence = renderQuranBacktickBlock;

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

router.get('/quran-audio/recitations', function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    recitations: LOCAL_QURAN_AUDIO_RECITERS.map(reciter => ({
      id: reciter.id,
      shortName: reciter.shortName,
      reciter_name: reciter.reciter_name,
      label: reciter.label
    }))
  });
});

router.get('/quran-audio/passage', function (req, res) {
  const surah = Number(req.query.s);
  const ayahFrom = Number(req.query.from);
  const ayahTo = req.query.to === undefined ? ayahFrom : Number(req.query.to);
  const reciter = localQuranAudioReciter(req.query.reciter || req.query.recitation_id || req.query.recitationId || 'juhani');
  if (!reciter || !Number.isInteger(surah) || !Number.isInteger(ayahFrom) || !Number.isInteger(ayahTo) ||
      !validQuranRange(surah, ayahFrom, ayahTo, false)) {
    res.status(400).json({ error: 'Invalid Quran audio request.' });
    return;
  }

  const result = localQuranAudioPassage(reciter, surah, ayahFrom, ayahTo);
  if (result.audio.length < 1) {
    res.status(404).json({ error: 'No Quran audio is available for this passage.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    reciter: reciter.id,
    reciterName: reciter.reciter_name,
    surah: surah,
    from: ayahFrom,
    to: ayahTo,
    audio: result.audio,
    missing: result.missing
  });
});

router.get('/tafsir/books', async function (req, res) {
  debug('proxy tafsir books start');
  const rows = await Tafsir.visibleTafsirs();
  debug(`proxy tafsir books done rows=${rows.length}`);
  res.setHeader('Cache-Control', 'no-store');
  res.json(rows);
});

router.get('/translations/books', async function (req, res) {
  debug('proxy translations books start');
  const rows = await Tafsir.visibleTranslations();
  debug(`proxy translations books done rows=${rows.length}`);
  res.setHeader('Cache-Control', 'no-store');
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
  const editMode = isEditMode(req) && (req.query.render || '').toString() !== 'reader';
  const entries = rows.map(row => {
    const alias = row.commentary_alias;
    const html = renderLocalCommentary(row, editMode, lang, alias);
    return {
      alias: alias,
      ordinal: Number(row.ordinal || 0),
      ayahs_start: row.ayahFrom,
      count: row.ayahTo - row.ayahFrom,
      bilingual: commentaryRowHasBothLanguages(row),
      html: html
    };
  }).filter(entry => entry.alias && (!lang || entry.html || Number.isInteger(Number(entry.ayahs_start))));
  res.setHeader('Cache-Control', 'no-store');
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
    const html = renderLocalCommentary(row, editMode, lang, src);
    return {
      id: row.id,
      ayahs_start: row.ayahFrom,
      count: row.ayahTo - row.ayahFrom,
      bilingual: commentaryRowHasBothLanguages(row),
      ...(translationEstimate ? {
        translation_points: translationEstimate.points,
        translation_word_count: translationEstimate.wordCount,
        translation_existing: localCommentaryTranslationExisting(row, lang)
      } : {}),
      html: html
    };
  }).filter(entry => !lang || entry.html || Number.isInteger(Number(entry.ayahs_start)));
  if (!entries.length) {
    res.status(404).json({ error: 'No local tafsir text is available for this ayah.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
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
    res.setHeader('Cache-Control', 'no-store');
    res.json(response.data);
  } catch (err) {
    debug.error(`tafsir.app unavailable for ${src} ${surah}:${ayah}: ${err.message}\n${err.stack || ''}`);
    res.setHeader('Cache-Control', 'no-store');
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
    res.setHeader('Cache-Control', 'no-store');
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

function localQuranAudioReciter(value) {
  const key = trimToEmpty(value || 'juhani').toLowerCase();
  return LOCAL_QURAN_AUDIO_RECITERS.find(reciter => reciter.aliases.indexOf(key) !== -1) || null;
}

function localQuranAudioPassage(reciter, surah, ayahFrom, ayahTo) {
  const audio = [];
  const missing = [];
  for (let ayah = ayahFrom; ayah <= ayahTo; ayah += 1) {
    const filename = `${padQuranAudioNumber(surah)}${padQuranAudioNumber(ayah)}.mp3`;
    const relativeUrl = `/audio/${reciter.slug}/${filename}`;
    const filePath = path.join(PUBLIC_DIR, 'audio', reciter.slug, filename);
    if (fs.existsSync(filePath)) {
      audio.push({
        verseKey: `${surah}:${ayah}`,
        ayah: ayah,
        url: relativeUrl
      });
    } else {
      missing.push({
        verseKey: `${surah}:${ayah}`,
        ayah: ayah,
        filename: filename
      });
    }
  }
  return {
    audio: audio,
    missing: missing
  };
}

function padQuranAudioNumber(value) {
  return String(value).padStart(3, '0');
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
  }, [
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
  ], 0, size, 'commentary_alias ASC, ayahFrom ASC, ayahTo ASC', false);
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
  rows.forEach(row => {
    for (let ayah = row.ayahFrom; ayah <= row.ayahTo; ayah++)
      coveredAyahs.add(ayah);
  });
  for (let ayah = ayahFrom; ayah <= ayahTo; ayah++) {
    if (coveredAyahs.has(ayah))
      continue;
    rows.push({
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
  if (lang && commentaryRowHasBothLanguages(row))
    lang = '';
  if (lang === 'ar')
    return renderLocalCommentaryLanguage(row, editMode, 'ar', src);
  if (lang === 'en')
    return renderLocalCommentaryLanguage(row, editMode, 'en', src);
  const footnoteIdPrefix = commentaryFootnoteIdPrefix(src, row.id);
  const arabic = editMode
    ? renderEditableCommentaryLanguage(row, 'ar', src)
    : renderCommentaryText(row.text, row.footnotes, commentaryFormat(row.format, 'ar'), { bracketedFootnotes: true, footnoteIdPrefix: footnoteIdPrefix });
  const english = editMode
    ? renderEditableCommentaryLanguage(row, 'en', src)
    : renderCommentaryText(row.text_en, row.footnotes_en, commentaryFormat(row.format, 'en'), { footnoteIdPrefix: footnoteIdPrefix, quranBackticks: true });
  if (arabic && english)
    return `<div class="row quran-tafsir-local-pair"><section class="col-md-6 col-sm-12" lang="en">${english}</section><section class="col-md-6 col-sm-12" lang="ar" dir="rtl">${arabic}</section></div>`;
  const sections = [];
  if (arabic)
    sections.push(`<section lang="ar" dir="rtl">${arabic}</section>`);
  if (english)
    sections.push(`<section lang="en">${english}</section>`);
  return sections.join('\n');
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
  if (lang === 'ar')
    return false;
  if (lang === 'en')
    return commentaryRowHasLanguage(row, 'en');
  return commentaryRowHasLanguage(row, 'en');
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
    renderEditableCommentaryField(row.id, `text${suffix}`, text, format, lang, src),
    renderEditableCommentaryField(row.id, `footnotes${suffix}`, footnotes, format, lang, src)
  ].join('\n');
}

function renderEditableCommentaryField(id, column, text, format, lang, src) {
  const value = text || '';
  const placeholder = commentaryFieldPlaceholder(column, lang);
  const escapedPlaceholder = escapeHtml(placeholder);
  const attrs = `class="_e quran-tafsir-editor${format === 'md' ? '' : ' form-control'}" data-id="${id}" data-prop="commentary.${column}" data-edit-format="${format}" data-edit-lang="${lang}" data-placeholder="${escapedPlaceholder}"`;
  if (format === 'md')
    return `<div ${attrs} data-markdown-source="${escapeHtml(value)}" data-markdown-empty-html="${escapedPlaceholder}">${renderCommentaryText(value, '', format, { bracketedFootnotes: lang === 'ar', footnoteIdPrefix: commentaryFootnoteIdPrefix(src, id), quranBackticks: lang === 'en' }) || escapedPlaceholder}</div>`;
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
  let content = [text, footnotes].filter(Boolean).map(Tafsir.stripPageMarkers).join('\n\n');
  if (options.bracketedFootnotes)
    content = bracketedFootnotesToMarkdown(content);
  if (format === 'html')
    return markArabicOnlyBlocks(namespaceFootnoteIds(content, options.footnoteIdPrefix));
  const renderer = options.quranBackticks ? quranBacktickMd : md;
  const html = renderer.render(content).replace(/<br>/g, '</p><p>');
  return markArabicOnlyBlocks(namespaceFootnoteIds(html, options.footnoteIdPrefix));
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
