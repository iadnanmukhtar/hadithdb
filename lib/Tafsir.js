'use strict';

const debug = require('./Debug')('hadithdb:Tafsir');
const axios = require('axios');
const cheerio = require('cheerio');
const MarkdownIt = require('markdown-it');
const markdownitFootnote = require('markdown-it-footnote');
const Index = require('./Index');
const Surahs = require('./Surahs');
const Utils = require('./Utils');
const Books = require('./Books');
const PaymentConfig = require('./PaymentConfig');

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
const quranBacktickMd = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
quranBacktickMd.renderer.rules.code_inline = renderQuranBacktickToken;
quranBacktickMd.renderer.rules.code_block = renderQuranBacktickBlock;
quranBacktickMd.renderer.rules.fence = renderQuranBacktickBlock;

function visibleTafsirsSync() {
  if (Array.isArray(global.tafsirCarouselBooks))
    return global.tafsirCarouselBooks;
  global.tafsirCarouselBooks = expandBilingualLocalCommentaries((global.commentaries || [])
    .filter(row => Number(row.hidden) === 0 && commentaryType(row) === 'tafsir')
    .map(({ hidden, ...row }) => row))
    .map(row => ({ ...row, slug: tafsirSlug(row.alias) }));
  return global.tafsirCarouselBooks;
}

async function visibleTafsirs() {
  return visibleTafsirsSync();
}

function visibleTranslationsSync() {
  return (global.commentaries || [])
    .filter(row => Number(row.hidden) === 0 && commentaryType(row) === 'trans')
    .map(({ hidden, ...row }) => row);
}

async function visibleTranslations() {
  return visibleTranslationsSync();
}

function commentaryType(row) {
  return (row && row.type ? row.type : 'tafsir').toString();
}

async function withFirstPassages(tafsirs) {
  if (!(global.tafsirFirstPassages instanceof Map))
    global.tafsirFirstPassages = new Map();
  await Promise.all((tafsirs || []).map(async function (tafsir) {
    const key = `${tafsir.alias}:${Number(tafsir.surah_dir) || 0}`;
    if (!global.tafsirFirstPassages.has(key))
      global.tafsirFirstPassages.set(key, firstPassage(tafsir));
    debug(`tafsir first passage lookup start alias=${tafsir.alias} source=${tafsir.source} key=${key}`);
    const first = await global.tafsirFirstPassages.get(key);
    debug(`tafsir first passage lookup done alias=${tafsir.alias} key=${key} passage=${first?.surah || 1}:${first?.ayah || 1}`);
    tafsir.firstSurah = first?.surah || 1;
    tafsir.firstAyah = first?.ayah || 1;
  }));
  return tafsirs;
}

function expandBilingualLocalCommentaries(rows) {
  const expanded = [];
  rows.forEach(row => {
    if (row.source === 'local' && row.lang === 'en-ar') {
      expanded.push({ ...row, lang: 'en' });
      expanded.push({ ...row, lang: 'ar' });
      return;
    }
    expanded.push(row);
    if (row.source === 'local' && row.lang === 'en' && hasCommentaryLanguageFormat(row.format, 'ar'))
      expanded.push({ ...row, lang: 'ar' });
  });
  return expanded;
}

function hasCommentaryLanguageFormat(format, lang) {
  return (format || '').split(',').map(value => value.trim()).some(value => value.startsWith(`${lang}:`));
}

function isBilingualTafsir(book) {
  if (!book || book.source !== 'local')
    return false;
  if (book.lang === 'en-ar')
    return true;
  return hasCommentaryLanguageFormat(book.format, 'en') && hasCommentaryLanguageFormat(book.format, 'ar');
}

function commentaryRowHasLanguage(row, lang) {
  if (lang === 'en')
    return Utils.trimToEmpty(row && (row.text_en || row.footnotes_en)) !== '';
  if (lang === 'ar')
    return Utils.trimToEmpty(row && (row.text || row.footnotes)) !== '';
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
    if (Utils.trimToEmpty(row[`text_${code}`]) || Utils.trimToEmpty(row[`footnote_${code}`]))
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
    if (Utils.trimToEmpty(fields.text) || Utils.trimToEmpty(fields.footnotes))
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
  code = Utils.trimToEmpty(code).toLowerCase();
  return /^[a-z][a-z0-9]{1,15}$/.test(code) ? code : '';
}

function tafsirSlug(alias) {
  return (alias || '').toString().replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
}

async function resolveTafsir(ref, lang) {
  ref = (ref || '').toString();
  lang = normalizeLanguage(lang);
  const rows = await visibleTafsirs();
  const candidates = rows.filter(row => {
    return row.alias === ref || row.slug === ref || row.alias === `tafsir-${ref}` || row.alias === `en-tafsir-${ref}` || row.alias === `en-${ref}` || row.alias === `ar-${ref}`;
  });
  if (lang) {
    const languageMatch = candidates.find(row => row.lang === lang);
    if (languageMatch)
      return languageMatch;
  }
  return candidates[0] || null;
}

function normalizeLanguage(lang) {
  lang = (lang || '').toString();
  return lang === 'ar' || lang === 'en' ? lang : '';
}

async function tafsirEntries(book, surah, ayah, options = {}) {
  if (book.source === 'local')
    return localTafsirEntries(book, surah, ayah, options);
  return remoteTafsirEntries(book, surah, ayah);
}

async function localTranslationEntry(book, surah, ayah) {
  if (!book || book.type !== 'trans' || book.source !== 'local')
    return null;
  const rows = await localCommentaryRowsFromIndex(book.alias, surah, ayah, ayah);
  const row = rows.find(row => commentaryRowHasLanguage(row, 'en')) || rows[0];
  if (!row)
    return null;
  const html = renderLocalCommentaryLanguage(row, false, 'en', book.alias);
  if (!html)
    return null;
  return {
    alias: book.alias,
    surah: row.surah,
    startAyah: row.ayahFrom,
    endAyah: row.ayahTo,
    html: html
  };
}

async function localTafsirEntries(book, surah, ayah, options = {}) {
  debug(`local tafsir entries start alias=${book.alias} ref=${surah}:${ayah} editMode=${!!options.editMode}`);
  const rows = await localCommentaryRowsFromIndex(book.alias, surah, ayah, ayah);
  debug(`local tafsir entries index rows=${rows.length} alias=${book.alias} ref=${surah}:${ayah}`);
  if (!rows.length && options.editMode)
    addMissingEditableCommentaryRows(rows, book, surah, ayah, ayah);
  const renderLang = isBilingualTafsir(book) ? '' : book.lang;
  return rows.map(row => {
    const rendered = renderLocalCommentaryResult(row, options.editMode, renderLang, book.alias);
    return {
      surah: row.surah,
      startAyah: row.ayahFrom,
      endAyah: row.ayahTo,
      bilingual: rendered.bilingual,
      html: rendered.html,
      contentTranslationLanguage: rendered.contentTranslationLanguage,
      arabicHtml: rendered.arabicHtml
    };
  }).filter(entry => options.includeEmpty || entry.html);
}

async function remoteTafsirEntries(book, surah, ayah) {
  const t0 = Date.now();
  debug(`remote tafsir.app start alias=${book.alias} ref=${surah}:${ayah}`);
  let response;
  try {
    response = await axios.get('https://tafsir.app/get.php', {
      params: {
        src: book.alias,
        s: surah,
        a: ayah,
        ver: 1
      },
      timeout: 10000
    });
  } catch (err) {
    debug.error(`remote tafsir.app failed alias=${book.alias} ref=${surah}:${ayah} elapsedMs=${Date.now() - t0}: ${err.message}\n${err.stack || ''}`);
    throw err;
  }
  const elapsedMs = Date.now() - t0;
  debug(`remote tafsir.app done alias=${book.alias} ref=${surah}:${ayah} status=${response.status} elapsedMs=${elapsedMs}`);
  debug.slow('tafsir.app', elapsedMs, `alias=${book.alias} ref=${surah}:${ayah} status=${response.status}`);
  const payload = response.data || {};
  const text = payload.data || '';
  if (!text)
    return [];
  const startAyah = Number(payload.ayahs_start || ayah);
  const count = Number(payload.count || 0);
  const format = book.format || 'txt';
  const html = format === 'html'
    ? markArabicOnlyBlocks(namespaceFootnoteIds(text, commentaryFootnoteIdPrefix(book.alias, startAyah)))
    : renderCommentaryText(text, '', format, {
      bracketedFootnotes: book.lang === 'ar',
      footnoteIdPrefix: commentaryFootnoteIdPrefix(book.alias, startAyah),
      quranBackticks: book.lang === 'en'
    });
  return [{
    surah: surah,
    startAyah: startAyah,
    endAyah: startAyah + count,
    html: html
  }].filter(entry => entry.html);
}

async function adjacentPassage(book, entries, direction, currentRef) {
  if ((!entries || entries.length < 1) && book.source !== 'local')
    entries = remoteFallbackEntriesFromQuran(currentRef);
  if (!entries || entries.length < 1)
    return null;
  const current = currentPassageRange(entries);
  if (!current)
    return null;
  if (book.source === 'local')
    return localAdjacentPassage(book, current, direction);
  return remoteAdjacentPassage(book, current, direction);
}

function remoteFallbackEntriesFromQuran(currentRef) {
  const ayah = quranAyahFromMemory(currentRef);
  if (!ayah)
    return [];
  return [{
    surah: ayah.surah,
    startAyah: ayah.ayah,
    endAyah: ayah.ayah
  }];
}

async function firstPassage(book) {
  if (!book)
    return null;
  if (book.source !== 'local')
    return { surah: isReverseSurahOrder(book) ? 114 : 1, ayah: 1 };
  let rows;
  try {
    debug(`tafsir first passage index start alias=${book.alias}`);
    rows = await Index.docsFromQueryFields('commentaries', {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } },
          { range: { ayahFrom: { gte: 1 } } },
          { range: { ayahTo: { gte: 1 } } }
        ]
      }
    }, ['surah', 'ayahFrom'], 0, 1, `${surahSortDirection(book, 1)}, ayahFrom ASC, ayahTo ASC`, false);
  } catch (err) {
    debug.error(`tafsir first passage index failed alias=${book.alias}: ${err.message}\n${err.stack || ''}`);
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    debug(`tafsir first passage db fallback start alias=${book.alias}`);
    rows = await localFirstPassageRowsFromDb(book);
  }
  const row = rows[0];
  if (!row && typeof global.query === 'function') {
    const dbRows = await localFirstPassageRowsFromDb(book);
    const dbRow = dbRows[0];
    if (dbRow)
      return {
        surah: Number(dbRow.surah),
        ayah: Number(dbRow.ayahFrom)
      };
  }
  if (!row)
    return { surah: 1, ayah: 1 };
  return {
    surah: Number(row.surah),
    ayah: Number(row.ayahFrom)
  };
}

async function firstPassageInSurah(book, surah) {
  if (!book || !Number.isInteger(Number(surah)))
    return null;
  surah = Number(surah);
  if (book.source !== 'local')
    return { surah: surah, ayah: 1 };
  let rows;
  try {
    rows = await Index.docsFromQueryFields('commentaries', {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } },
          { term: { surah: surah } },
          { range: { ayahFrom: { gte: 1 } } },
          { range: { ayahTo: { gte: 1 } } }
        ]
      }
    }, ['surah', 'ayahFrom'], 0, 1, 'ayahFrom ASC, ayahTo ASC', false);
  } catch (err) {
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await localFirstPassageInSurahRowsFromDb(book, surah);
  }
  const row = rows[0];
  if (!row)
    return null;
  return {
    surah: Number(row.surah),
    ayah: Number(row.ayahFrom)
  };
}

async function sitemapPassages(book, options = {}) {
  if (!book)
    return [];
  if (book.source !== 'local') {
    const first = await firstPassage(book);
    return first ? [first] : [];
  }
  let rows;
  if (options.source === 'db') {
    rows = await localSitemapPassageRowsFromDb(book);
  } else {
    try {
      rows = await localSitemapPassageRowsFromIndex(book);
    } catch (err) {
      if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
        throw err;
      rows = await localSitemapPassageRowsFromDb(book);
    }
  }
  const seen = new Set();
  return rows.map(row => ({
    surah: Number(row.surah),
    ayah: Number(row.ayahFrom)
  })).filter(passage => {
    const key = `${passage.surah}:${passage.ayah}`;
    if (!Number.isInteger(passage.surah) || !Number.isInteger(passage.ayah) || seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

async function localSitemapPassageRowsFromIndex(book) {
  return Index.docsFromQueryFields('commentaries', {
    bool: {
      filter: [
        { term: { doctype: 'commentary' } },
        { term: { commentary_alias: book.alias } },
        { term: { source: 'local' } },
        { range: { ayahFrom: { gte: 1 } } },
        { range: { ayahTo: { gte: 1 } } }
      ]
    }
  }, ['surah', 'ayahFrom', 'ayahTo'], 0, 10000, `${surahSortDirection(book, 1)}, ayahFrom ASC, ayahTo ASC`, false);
}

function currentPassageRange(entries) {
  const sorted = entries
    .filter(entry => Number.isInteger(Number(entry.surah)) && Number.isInteger(Number(entry.startAyah)) && Number.isInteger(Number(entry.endAyah)))
    .map(entry => ({
      surah: Number(entry.surah),
      startAyah: Number(entry.startAyah),
      endAyah: Number(entry.endAyah)
    }))
    .sort((a, b) => a.surah - b.surah || a.startAyah - b.startAyah || a.endAyah - b.endAyah);
  if (!sorted.length)
    return null;
  return {
    surah: sorted[0].surah,
    startAyah: Math.min(...sorted.map(entry => entry.startAyah)),
    endAyah: Math.max(...sorted.map(entry => entry.endAyah))
  };
}

async function localAdjacentPassage(book, current, direction) {
  const reverseSurahs = isReverseSurahOrder(book);
  const forwardSurahRange = reverseSurahs ? 'lt' : 'gt';
  const backwardSurahRange = reverseSurahs ? 'gt' : 'lt';
  const query = direction > 0
    ? {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } },
          { range: { ayahFrom: { gte: 1 } } },
          { range: { ayahTo: { gte: 1 } } }
        ],
        should: [
          { bool: { filter: [{ term: { surah: current.surah } }, { range: { ayahFrom: { gt: current.endAyah } } }] } },
          { range: { surah: { [forwardSurahRange]: current.surah } } }
        ],
        minimum_should_match: 1
      }
    }
    : {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } },
          { range: { ayahFrom: { gte: 1 } } },
          { range: { ayahTo: { gte: 1 } } }
        ],
        should: [
          { bool: { filter: [{ term: { surah: current.surah } }, { range: { ayahTo: { lt: current.startAyah } } }] } },
          { range: { surah: { [backwardSurahRange]: current.surah } } }
        ],
        minimum_should_match: 1
      }
    };
  const orderBy = direction > 0
    ? `${surahSortDirection(book, 1)}, ayahFrom ASC, ayahTo ASC`
    : `${surahSortDirection(book, -1)}, ayahTo DESC, ayahFrom DESC`;
  let rows;
  try {
    rows = await Index.docsFromQuery('commentaries', query, 0, 1, orderBy, false);
  } catch (err) {
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await localAdjacentPassageRowsFromDb(book, current, direction);
  }
  const row = rows[0];
  if (!row)
    return null;
  return {
    surah: Number(row.surah),
    ayah: Number(row.ayahFrom)
  };
}

async function remoteAdjacentPassage(book, current, direction) {
  if (direction > 0) {
    const candidate = nextQuranAyah(book, current.surah, current.endAyah);
    if (!candidate)
      return null;
    const entries = await remoteTafsirEntries(book, candidate.surah, candidate.ayah);
    const next = currentPassageRange(entries);
    if (next && isNextPassage(book, next, current))
      return { surah: next.surah, ayah: next.startAyah };
    return candidate;
  }

  let candidate = previousQuranAyah(book, current.surah, current.startAyah);
  while (candidate) {
    const entries = await remoteTafsirEntries(book, candidate.surah, candidate.ayah);
    const previous = currentPassageRange(entries);
    if (!previous)
      return candidate;
    if (isPreviousPassage(book, previous, current))
      return { surah: previous.surah, ayah: previous.startAyah };
    candidate = previousQuranAyah(book, previous.surah, previous.startAyah);
  }
  return null;
}

function isNextPassage(book, next, current) {
  if (next.surah === current.surah)
    return next.startAyah > current.endAyah;
  return isReverseSurahOrder(book)
    ? next.surah < current.surah
    : next.surah > current.surah;
}

function quranAyahFromMemory(ref) {
  const surahNum = Number(ref && ref.surah);
  const ayahNum = Number(ref && ref.ayah);
  if (!Number.isInteger(surahNum) || !Number.isInteger(ayahNum) || ayahNum < 1)
    return null;
  const surah = Surahs.find(surahNum);
  if (!surah || ayahNum > Number(surah.ayahs))
    return null;
  return {
    surah: surahNum,
    ayah: ayahNum
  };
}

function nextQuranAyah(book, surahNum, ayahNum) {
  const surah = Surahs.find(surahNum);
  if (!surah)
    return null;
  if (Number(ayahNum) < Number(surah.ayahs))
    return { surah: Number(surahNum), ayah: Number(ayahNum) + 1 };
  const nextSurahNum = Number(surahNum) + (isReverseSurahOrder(book) ? -1 : 1);
  const nextSurah = Surahs.find(nextSurahNum);
  return nextSurah ? { surah: Number(nextSurah.num), ayah: 1 } : null;
}

function previousQuranAyah(book, surahNum, ayahNum) {
  if (Number(ayahNum) > 1)
    return { surah: Number(surahNum), ayah: Number(ayahNum) - 1 };
  const previousSurahNum = Number(surahNum) + (isReverseSurahOrder(book) ? 1 : -1);
  const previousSurah = Surahs.find(previousSurahNum);
  return previousSurah ? { surah: Number(previousSurah.num), ayah: Number(previousSurah.ayahs) } : null;
}

function isReverseSurahOrder(book) {
  return Number(book && book.surah_dir) === 1;
}

function surahSortDirection(book, direction) {
  const forwardAsc = !isReverseSurahOrder(book);
  if (direction > 0)
    return `surah ${forwardAsc ? 'ASC' : 'DESC'}`;
  return `surah ${forwardAsc ? 'DESC' : 'ASC'}`;
}

function isPreviousPassage(book, previous, current) {
  if (previous.surah === current.surah)
    return previous.endAyah < current.startAyah;
  return isReverseSurahOrder(book)
    ? previous.surah > current.surah
    : previous.surah < current.surah;
}

async function localCommentaryRowsFromIndex(src, surah, ayahFrom, ayahTo) {
  const size = Math.min(1000, Math.max(1, ayahTo - ayahFrom + 21));
  let rows;
  try {
    debug(`local tafsir rows index start alias=${src} ref=${surah}:${ayahFrom}-${ayahTo} size=${size}`);
    rows = await Index.docsFromQuery('commentaries', {
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
  } catch (err) {
    debug.error(`local tafsir rows index failed alias=${src} ref=${surah}:${ayahFrom}-${ayahTo}: ${err.message}\n${err.stack || ''}`);
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    debug(`local tafsir rows db fallback start alias=${src} ref=${surah}:${ayahFrom}-${ayahTo}`);
    rows = await localCommentaryRowsFromDb(src, surah, ayahFrom, ayahTo, size);
  }
  if (!rows.length && typeof global.query === 'function')
    rows = await localCommentaryRowsFromDb(src, surah, ayahFrom, ayahTo, size);
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

async function localFirstPassageRowsFromDb(book) {
  const alias = global.dbPool.escape(book.alias);
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  return global.query(`
    SELECT hc.surah, hc.ayahFrom
    FROM ${commentaryJoin.from}
    ${commentaryJoin.join}
    WHERE bc.source='local'
      AND bc.hidden=0
      AND ${commentaryJoin.typePredicate}
      AND bc.alias=${alias}
      AND hc.ayahFrom>=1
      AND hc.ayahTo>=1
    ORDER BY hc.surah ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 1`);
}

async function localFirstPassageInSurahRowsFromDb(book, surah) {
  const alias = global.dbPool.escape(book.alias);
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  return global.query(`
    SELECT hc.surah, hc.ayahFrom
    FROM ${commentaryJoin.from}
    ${commentaryJoin.join}
    WHERE bc.source='local'
      AND bc.hidden=0
      AND ${commentaryJoin.typePredicate}
      AND bc.alias=${alias}
      AND hc.surah=${Number(surah)}
      AND hc.ayahFrom>=1
      AND hc.ayahTo>=1
    ORDER BY hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 1`);
}

async function localSitemapPassageRowsFromDb(book) {
  const alias = global.dbPool.escape(book.alias);
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  return global.query(`
    SELECT hc.surah, hc.ayahFrom
    FROM ${commentaryJoin.from}
    ${commentaryJoin.join}
    WHERE bc.source='local'
      AND bc.hidden=0
      AND ${commentaryJoin.typePredicate}
      AND bc.alias=${alias}
      AND hc.ayahFrom>=1
      AND hc.ayahTo>=1
    ORDER BY hc.surah ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 10000`);
}

async function localAdjacentPassageRowsFromDb(book, current, direction) {
  const alias = global.dbPool.escape(book.alias);
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  const reverseSurahs = isReverseSurahOrder(book);
  const surahOperator = direction > 0
    ? (reverseSurahs ? '<' : '>')
    : (reverseSurahs ? '>' : '<');
  const sameSurahClause = direction > 0
    ? `hc.ayahFrom>${Number(current.endAyah)}`
    : `hc.ayahTo<${Number(current.startAyah)}`;
  const orderBy = direction > 0
    ? `hc.surah ${reverseSurahs ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC`
    : `hc.surah ${reverseSurahs ? 'ASC' : 'DESC'}, hc.ayahTo DESC, hc.ayahFrom DESC`;
  return global.query(`
    SELECT hc.surah, hc.ayahFrom, hc.ayahTo
    FROM ${commentaryJoin.from}
    ${commentaryJoin.join}
    WHERE bc.source='local'
      AND bc.hidden=0
      AND ${commentaryJoin.typePredicate}
      AND bc.alias=${alias}
      AND hc.ayahFrom>=1
      AND hc.ayahTo>=1
      AND (
        (hc.surah=${Number(current.surah)} AND ${sameSurahClause})
        OR hc.surah${surahOperator}${Number(current.surah)}
      )
    ORDER BY ${orderBy}
    LIMIT 1`);
}

async function localCommentaryRowsFromDb(src, surah, ayahFrom, ayahTo, size) {
  const alias = global.dbPool.escape(src);
  const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
  return global.query(`
    SELECT
      hc.id,
      bc.format,
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
      AND bc.alias=${alias}
      AND hc.surah=${Number(surah)}
      AND hc.ayahFrom<=${Number(ayahTo)}
      AND hc.ayahTo>=${Number(ayahFrom)}
    ORDER BY hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT ${Number(size)}`);
}

function isSearchBackendUnavailable(err) {
  const status = err && (err.status || err.statusCode);
  return [502, 503, 504].includes(Number(status));
}

function addMissingEditableCommentaryRows(rows, book, surah, ayahFrom, ayahTo) {
  if (!book || book.source !== 'local')
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
      id: newCommentaryId(book.alias, surah, ayah, ayah),
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
  const fontClass = Utils.trimToEmpty(translation && translation.fontClass).replace(/[^A-Za-z0-9_-]+/g, ' ');
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
  let content = [text, footnotes].filter(Boolean).map(stripPageMarkers).join('\n\n');
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

function stripPageMarkers(text) {
  if (!text)
    return text;
  return text.toString()
    .replace(/\\?\(p\\?-[0-9\u0660-\u0669\u06F0-\u06F9]+\\?\)/gu, '')
    .replace(/<p[^>]*class=["']page-num["'][^>]*>\s*صفحة\s+[0-9\u0660-\u0669\u06F0-\u06F9]+\s*<\/p>/giu, '')
    .replace(/(?:^|\n)[ \t]*صفحة\s+[0-9\u0660-\u0669\u06F0-\u06F9]+[ \t]*(?=\n|$)/gu, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function escapeHtml(text) {
  return (text || '').toString().replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function sourceLabel(source) {
  return source === 'local' ? 'Local' : 'Remote';
}

function languageLabel(lang) {
  return lang === 'ar' ? 'Arabic' : 'English';
}

function rawShortName(book, lang = 'en') {
  const fallback = book?.shortName_en || book?.shortName || book?.name_en || book?.title || book?.alias || 'Tafsir';
  return lang === 'ar'
    ? (book?.shortName || book?.shortName_en || book?.title || book?.name_en || book?.alias || fallback)
    : fallback;
}

function displayShortName(book, lang = 'en') {
  const value = rawShortName(book, lang);
  if (lang === 'ar') {
    if (/^التفسير(?:\s|$)/u.test(value))
      return value.replace(/^التفسير/u, 'تفسير');
    if (/^تفسير(?:\s|$)/u.test(value))
      return value;
    return `تفسير ${value}`;
  }
  if (/^tafs[īi]r\b/i.test(value))
    return value;
  return `Tafsir ${value}`;
}

function browseUrl(book, surah = 1, ayah = 1, tafsirs) {
  const slug = book.slug || tafsirSlug(book.alias);
  const langParam = needsTafsirLanguageParam(book, tafsirs) ? `?lang=${encodeURIComponent(book.lang)}` : '';
  return `/quran/tafsir/${encodeURIComponent(slug)}/${surah}/${ayah}${langParam}`;
}

function needsTafsirLanguageParam(book, tafsirs) {
  if (!book || (book.lang !== 'ar' && book.lang !== 'en'))
    return false;
  if (!Array.isArray(tafsirs))
    return false;
  const slug = book.slug || tafsirSlug(book.alias);
  return tafsirs.some(other => {
    if (!other || other === book || other.lang === book.lang)
      return false;
    return (other.slug || tafsirSlug(other.alias)) === slug;
  });
}

module.exports = {
  browseUrl,
  adjacentPassage,
  displayShortName,
  expandBilingualLocalCommentaries,
  firstPassage,
  firstPassageInSurah,
  isBilingualTafsir,
  languageLabel,
  rawShortName,
  resolveTafsir,
  localTranslationEntry,
  sitemapPassages,
  sourceLabel,
  stripPageMarkers,
  tafsirEntries,
  tafsirSlug,
  visibleTafsirsSync,
  visibleTafsirs,
  visibleTranslationsSync,
  visibleTranslations,
  withFirstPassages
};
