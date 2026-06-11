'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const MarkdownIt = require('markdown-it');
const markdownitFootnote = require('markdown-it-footnote');
const Commentaries = require('./Commentaries');
const Index = require('./Index');
const Utils = require('./Utils');

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
const quranBacktickMd = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);
quranBacktickMd.renderer.rules.code_inline = renderQuranBacktickToken;
quranBacktickMd.renderer.rules.code_block = renderQuranBacktickBlock;
quranBacktickMd.renderer.rules.fence = renderQuranBacktickBlock;

async function visibleTafsirs() {
  if (!global.commentaries || global.commentaries.length < 1)
    await Commentaries.loadCommentaries();
  return expandBilingualLocalCommentaries((global.commentaries || [])
    .filter(row => Number(row.hidden) === 0)
    .map(({ hidden, ...row }) => row))
    .map(row => ({ ...row, slug: tafsirSlug(row.alias) }));
}

function expandBilingualLocalCommentaries(rows) {
  const expanded = [];
  rows.forEach(row => {
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

async function localTafsirEntries(book, surah, ayah, options = {}) {
  const rows = await localCommentaryRowsFromIndex(book.alias, surah, ayah, ayah);
  if (!rows.length && options.editMode)
    addMissingEditableCommentaryRows(rows, book, surah, ayah, ayah);
  const renderLang = isBilingualTafsir(book) ? '' : book.lang;
  return rows.map(row => {
    const html = renderLocalCommentary(row, options.editMode, renderLang, book.alias);
    return {
      surah: row.surah,
      startAyah: row.ayahFrom,
      endAyah: row.ayahTo,
      bilingual: commentaryRowHasBothLanguages(row),
      html: html
    };
  }).filter(entry => entry.html);
}

async function remoteTafsirEntries(book, surah, ayah) {
  const response = await axios.get('https://tafsir.app/get.php', {
    params: {
      src: book.alias,
      s: surah,
      a: ayah,
      ver: 1
    },
    timeout: 10000
  });
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
      footnoteIdPrefix: book.lang === 'ar' ? commentaryFootnoteIdPrefix(book.alias, startAyah) : '',
      quranBackticks: book.lang === 'en'
    });
  return [{
    surah: surah,
    startAyah: startAyah,
    endAyah: startAyah + count,
    html: html
  }].filter(entry => entry.html);
}

async function adjacentPassage(book, entries, direction) {
  if (!entries || entries.length < 1)
    return null;
  const current = currentPassageRange(entries);
  if (!current)
    return null;
  if (book.source === 'local')
    return localAdjacentPassage(book, current, direction);
  return remoteAdjacentPassage(book, current, direction);
}

async function firstPassage(book) {
  if (!book)
    return null;
  if (book.source !== 'local')
    return { surah: isReverseSurahOrder(book) ? 114 : 1, ayah: 1 };
  let rows;
  try {
    rows = await Index.docsFromQuery('commentaries', {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } }
        ]
      }
    }, 0, 1, `${surahSortDirection(book, 1)}, ayahFrom ASC, ayahTo ASC`, false);
  } catch (err) {
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
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
    rows = await Index.docsFromQuery('commentaries', {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } },
          { term: { surah: surah } }
        ]
      }
    }, 0, 1, 'ayahFrom ASC, ayahTo ASC', false);
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

async function sitemapPassages(book) {
  if (!book)
    return [];
  if (book.source !== 'local') {
    const first = await firstPassage(book);
    return first ? [first] : [];
  }
  let rows;
  try {
    rows = await Index.docsFromQuery('commentaries', {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } }
        ]
      }
    }, 0, 10000, `${surahSortDirection(book, 1)}, ayahFrom ASC, ayahTo ASC`, false);
  } catch (err) {
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await localSitemapPassageRowsFromDb(book);
  }
  if (!rows.length && typeof global.query === 'function')
    rows = await localSitemapPassageRowsFromDb(book);
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

async function sectionMenu(book) {
  if (!book || book.source !== 'local')
    return [];
  let rows;
  try {
    rows = await Index.docsFromQuery('commentaries', {
      bool: {
        filter: [
          { term: { doctype: 'commentary' } },
          { term: { commentary_alias: book.alias } },
          { term: { source: 'local' } }
        ]
      }
    }, 0, 10000, `${surahSortDirection(book, 1)}, ayahFrom ASC, ayahTo ASC`, false);
  } catch (err) {
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await localSectionMenuRowsFromDb(book);
  }
  if (!rows.length && typeof global.query === 'function')
    rows = await localSectionMenuRowsFromDb(book);

  const seen = new Set();
  return rows.map(row => {
    const surah = Number(row.surah);
    const ayahFrom = Number(row.ayahFrom);
    const ayahTo = Number(row.ayahTo);
    return {
      surah: surah,
      ayahFrom: ayahFrom,
      ayahTo: Number.isInteger(ayahTo) && ayahTo >= ayahFrom ? ayahTo : ayahFrom,
      title_en: Utils.trimToEmpty(row.h2_title_en || row.h1_title_en),
      title: Utils.trimToEmpty(row.h2_title || row.h1_title)
    };
  }).filter(item => {
    const key = `${item.surah}:${item.ayahFrom}:${item.ayahTo}`;
    if (!Number.isInteger(item.surah) || !Number.isInteger(item.ayahFrom) || !Number.isInteger(item.ayahTo) || seen.has(key))
      return false;
    seen.add(key);
    return true;
  }).map((item, index) => ({ ...item, index: index + 1 }));
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
          { term: { source: 'local' } }
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
          { term: { source: 'local' } }
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
  if (direction > 0)
    return nextQuranAyah(book, current.surah, current.endAyah);

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

function nextQuranAyah(book, surahNum, ayahNum) {
  const surah = (global.surahs || []).find(item => Number(item.num) === Number(surahNum));
  if (!surah)
    return null;
  if (Number(ayahNum) < Number(surah.ayahs))
    return { surah: Number(surahNum), ayah: Number(ayahNum) + 1 };
  const nextSurahNum = Number(surahNum) + (isReverseSurahOrder(book) ? -1 : 1);
  const nextSurah = (global.surahs || []).find(item => Number(item.num) === nextSurahNum);
  return nextSurah ? { surah: Number(nextSurah.num), ayah: 1 } : null;
}

function previousQuranAyah(book, surahNum, ayahNum) {
  if (Number(ayahNum) > 1)
    return { surah: Number(surahNum), ayah: Number(ayahNum) - 1 };
  const previousSurahNum = Number(surahNum) + (isReverseSurahOrder(book) ? 1 : -1);
  const previousSurah = (global.surahs || []).find(item => Number(item.num) === previousSurahNum);
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
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await localCommentaryRowsFromDb(src, surah, ayahFrom, ayahTo, size);
  }
  if (!rows.length && typeof global.query === 'function')
    rows = await localCommentaryRowsFromDb(src, surah, ayahFrom, ayahTo, size);
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

async function localFirstPassageRowsFromDb(book) {
  const alias = global.dbPool.escape(book.alias);
  return global.query(`
    SELECT hc.surah, hc.ayahFrom
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE bc.source='local'
      AND bc.hidden=0
      AND bc.alias=${alias}
    ORDER BY hc.surah ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 1`);
}

async function localFirstPassageInSurahRowsFromDb(book, surah) {
  const alias = global.dbPool.escape(book.alias);
  return global.query(`
    SELECT hc.surah, hc.ayahFrom
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE bc.source='local'
      AND bc.hidden=0
      AND bc.alias=${alias}
      AND hc.surah=${Number(surah)}
    ORDER BY hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 1`);
}

async function localSitemapPassageRowsFromDb(book) {
  const alias = global.dbPool.escape(book.alias);
  return global.query(`
    SELECT hc.surah, hc.ayahFrom
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE bc.source='local'
      AND bc.hidden=0
      AND bc.alias=${alias}
    ORDER BY hc.surah ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 10000`);
}

async function localSectionMenuRowsFromDb(book) {
  const alias = global.dbPool.escape(book.alias);
  return global.query(`
    SELECT
      hc.surah,
      hc.ayahFrom,
      hc.ayahTo,
      q.h1_title_en,
      q.h1_title,
      q.h2_title_en,
      q.h2_title
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    LEFT JOIN v_hadiths q ON q.id=hc.hadithId
    WHERE bc.source='local'
      AND bc.hidden=0
      AND bc.alias=${alias}
    ORDER BY hc.surah ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC
    LIMIT 10000`);
}

async function localAdjacentPassageRowsFromDb(book, current, direction) {
  const alias = global.dbPool.escape(book.alias);
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
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE bc.source='local'
      AND bc.hidden=0
      AND bc.alias=${alias}
      AND (
        (hc.surah=${Number(current.surah)} AND ${sameSurahClause})
        OR hc.surah${surahOperator}${Number(current.surah)}
      )
    ORDER BY ${orderBy}
    LIMIT 1`);
}

async function localCommentaryRowsFromDb(src, surah, ayahFrom, ayahTo, size) {
  const alias = global.dbPool.escape(src);
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
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE bc.source='local'
      AND bc.hidden=0
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
    : renderCommentaryText(row.text_en, row.footnotes_en, commentaryFormat(row.format, 'en'), { quranBackticks: true });
  if (arabic && english)
    return `<div class="row quran-tafsir-local-pair"><section class="col-md-6 col-sm-12" lang="en">${english}</section><section class="col-md-6 col-sm-12" lang="ar" dir="rtl">${arabic}</section></div>`;
  const sections = [];
  if (arabic)
    sections.push(`<section lang="ar" dir="rtl">${arabic}</section>`);
  if (english)
    sections.push(`<section lang="en">${english}</section>`);
  return sections.join('\n');
}

function renderLocalCommentaryLanguage(row, editMode, lang, src) {
  const content = editMode
    ? renderEditableCommentaryLanguage(row, lang, src)
    : renderCommentaryText(
      lang === 'en' ? row.text_en : row.text,
      lang === 'en' ? row.footnotes_en : row.footnotes,
      commentaryFormat(row.format, lang),
      { bracketedFootnotes: lang === 'ar', footnoteIdPrefix: lang === 'ar' ? commentaryFootnoteIdPrefix(src, row.id) : '', quranBackticks: lang === 'en' }
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
  const attrs = `class="_e quran-tafsir-editor${format === 'md' ? '' : ' form-control'}" data-id="${id}" data-prop="commentary.${column}" data-edit-format="${format}" data-edit-lang="${lang}"`;
  if (format === 'md')
    return `<div ${attrs} data-markdown-source="${escapeHtml(value)}" data-markdown-empty-html="&hellip;">${renderCommentaryText(value, '', format, { bracketedFootnotes: lang === 'ar', footnoteIdPrefix: lang === 'ar' ? commentaryFootnoteIdPrefix(src, id) : '', quranBackticks: lang === 'en' }) || '&hellip;'}</div>`;
  return `<textarea ${attrs} rows="12">${escapeHtml(value)}</textarea>`;
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
  let content = [text, footnotes].filter(Boolean).join('\n\n');
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

function displayShortName(book, lang = 'en') {
  const fallback = book?.shortName_en || book?.shortName || book?.name_en || book?.name || book?.alias || 'Tafsir';
  const value = lang === 'ar'
    ? (book?.shortName || book?.shortName_en || book?.name || book?.name_en || book?.alias || fallback)
    : fallback;
  if (lang === 'ar') {
    if (/^(?:التفسير|تفسير)(?:\s|$)/u.test(value))
      return value;
    return `التفسير ${value}`;
  }
  if (/^tafs[īi]r\b/i.test(value))
    return value;
  return `Tafsir ${value}`;
}

function browseUrl(book, surah = 1, ayah = 1, tafsirs) {
  const slug = book.slug || tafsirSlug(book.alias);
  return `/quran/tafsir/${encodeURIComponent(slug)}/${surah}/${ayah}`;
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
  resolveTafsir,
  sectionMenu,
  sitemapPassages,
  sourceLabel,
  tafsirEntries,
  tafsirSlug,
  visibleTafsirs
};
