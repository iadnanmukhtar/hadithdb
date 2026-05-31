'use strict';

const debug = require('debug')('hadithdb:proxy');
const express = require('express');
const axios = require('axios');
const https = require('https')
const cheerio = require('cheerio');
const MarkdownIt = require('markdown-it');
const markdownitFootnote = require('markdown-it-footnote');

const router = express.Router();
const md = new MarkdownIt({ html: true, linkify: true, typographer: false }).use(markdownitFootnote);

router.get('/tafsir/books', async function (req, res) {
  const rows = await global.query(`
    SELECT alias, shortName_en, shortName, name_en, name, author_en, author,
      death, lang, source, format, ordinal
    FROM books_commentaries
    WHERE hidden=0
    ORDER BY lang, ordinal, id`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(rows);
});

router.get('/tafsir/local', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = Number(req.query.a);
  if (!/^[A-Za-z0-9_-]+$/.test(src) || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayah) || ayah < 0) {
    res.status(400).json({ error: 'Invalid local tafsir request.' });
    return;
  }
  const rows = await global.query(`
    SELECT bc.format, hc.surah, hc.ayahFrom, hc.ayahTo, hc.text, hc.text_en, hc.footnotes, hc.footnotes_en
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE bc.alias=${global.dbPool.escape(src)}
      AND bc.source='local'
      AND hc.surah=${surah}
      AND hc.ayahFrom <= ${ayah}
      AND hc.ayahTo >= ${ayah}
    ORDER BY hc.ayahFrom, hc.ayahTo
    LIMIT 1`);
  if (!rows.length) {
    res.status(404).json({ error: 'No local tafsir text is available for this ayah.' });
    return;
  }
  const row = rows[0];
  res.setHeader('Cache-Control', 'public, max-age=14400');
  res.json({
    ayahs_start: row.ayahFrom,
    count: row.ayahTo - row.ayahFrom,
    html: renderLocalCommentary(row)
  });
});

router.get('/tafsir', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = Number(req.query.a);
  const version = Number(req.query.ver || 1);
  const tafsirs = await global.query(`
    SELECT alias
    FROM books_commentaries
    WHERE alias=${global.dbPool.escape(src)}
      AND source='tafsir.app'
    LIMIT 1`);

  if (!tafsirs.length || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayah) || ayah < 0 || !Number.isInteger(version) || version < 1) {
    res.status(400).json({ error: 'Invalid tafsir request.' });
    return;
  }

  const response = await axios.get('https://tafsir.app/get.php', {
    params: {
      src: src,
      s: surah,
      a: ayah,
      ver: version
    },
    timeout: 10000
  });
  res.setHeader('Cache-Control', 'public, max-age=2592000');
  res.json(response.data);
});

router.get('/:url', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  debug(`Proxy: ${req.params.url}`);
  try {
    const agent = new https.Agent({
      rejectUnauthorized: false
    });
    var resource;
    var text;
    var headers = req.headers;
    var url = new URL(req.params.url);
    headers.host = url.host;
    try {
      resource = await fetch(url.toString(), { method: 'GET', headers: headers, agent: agent });
      text = await resource.text();
    } catch (e) {
      console.log(e);
    }
    res.send(text);
    res.end();
    return;
  } catch (e) {
    console.log(`Proxy: ${req.params.url} ${e}`);
    throw new ReferenceError(`Proxy: ${req.params.url} ${e}`);
  }
});

function renderLocalCommentary(row) {
  const arabic = renderCommentaryText(row.text, row.footnotes, commentaryFormat(row.format, 'ar'));
  const english = renderCommentaryText(row.text_en, row.footnotes_en, commentaryFormat(row.format, 'en'));
  if (arabic && english)
    return `<div class="row quran-tafsir-local-pair"><section class="col-md-6 col-sm-12" lang="en">${english}</section><section class="col-md-6 col-sm-12" lang="ar" dir="rtl">${arabic}</section></div>`;
  const sections = [];
  if (arabic)
    sections.push(`<section lang="ar" dir="rtl">${arabic}</section>`);
  if (english)
    sections.push(`<section lang="en">${english}</section>`);
  return sections.join('\n');
}

function commentaryFormat(format, lang) {
  const formats = (format || 'txt').split(',').map(value => value.trim()).filter(Boolean);
  const languageFormat = formats.find(value => value.startsWith(`${lang}:`));
  if (languageFormat)
    return languageFormat.slice(lang.length + 1);
  const defaultFormat = formats.find(value => !value.includes(':'));
  return defaultFormat || 'txt';
}

function renderCommentaryText(text, footnotes, format) {
  if (!text)
    return '';
  const content = [text, footnotes].filter(Boolean).join('\n\n');
  if (format === 'html')
    return markArabicOnlyBlocks(content);
  if (format === 'md')
    return markArabicOnlyBlocks(md.render(content));
  return markArabicOnlyBlocks(md.render(asParagraphs(content)));
}

function asParagraphs(text) {
  return text.split(/\n+/).filter(Boolean).join('\n\n');
}

function markArabicOnlyBlocks(html) {
  const $ = cheerio.load(html, null, false);
  $('p, li, blockquote').each(function () {
    const element = $(this);
    const text = element.text();
    if (/\p{Script=Arabic}/u.test(text) && !/[A-Za-z]/.test(text))
      element.addClass('quran-tafsir-arabic-only').attr({ lang: 'ar', dir: 'rtl' });
  });
  return $.html();
}

module.exports = router;
