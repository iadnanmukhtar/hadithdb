'use strict';

const debug = require('debug')('hadithdb:proxy');
const express = require('express');
const axios = require('axios');
const https = require('https')
const cheerio = require('cheerio');
const MarkdownIt = require('markdown-it');
const markdownitFootnote = require('markdown-it-footnote');
const Commentaries = require('../lib/Commentaries');

const router = express.Router();
const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true }).use(markdownitFootnote);

router.get('/tafsir/books', async function (req, res) {
  if (!global.commentaries || global.commentaries.length < 1)
    await Commentaries.loadCommentaries();
  const rows = expandBilingualLocalCommentaries((global.commentaries || [])
    .filter(row => Number(row.hidden) === 0)
    .map(({ hidden, ...row }) => row));
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(rows);
});

router.get('/tafsir/local', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = Number(req.query.a);
  const lang = (req.query.lang || '').toString();
  if (!/^[A-Za-z0-9_-]+$/.test(src) || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayah) || ayah < 0 || (lang && lang !== 'ar' && lang !== 'en')) {
    res.status(400).json({ error: 'Invalid local tafsir request.' });
    return;
  }
  const rows = await global.query(`
    SELECT bc.format, hc.id, hc.surah, hc.ayahFrom, hc.ayahTo, hc.text, hc.text_en, hc.footnotes, hc.footnotes_en
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
  const html = renderLocalCommentary(row, isEditMode(req), lang);
  if (lang && !html) {
    res.status(404).json({ error: 'No local tafsir text is available for this ayah.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ayahs_start: row.ayahFrom,
    count: row.ayahTo - row.ayahFrom,
    html: html
  });
});

router.get('/tafsir', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = Number(req.query.a);
  const version = Number(req.query.ver || 1);
  if (!global.commentaries || global.commentaries.length < 1)
    await Commentaries.loadCommentaries();

  if (!global.tafsirAppAliases.has(src) || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
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

function expandBilingualLocalCommentaries(rows) {
  const expanded = [];
  rows.forEach(row => {
    expanded.push(row);
    if (row.source === 'local' && row.lang === 'en' && hasCommentaryLanguageFormat(row.format, 'ar')) {
      expanded.push({ ...row, lang: 'ar' });
    }
  });
  return expanded;
}

function hasCommentaryLanguageFormat(format, lang) {
  return (format || '').split(',').map(value => value.trim()).some(value => value.startsWith(`${lang}:`));
}

function renderLocalCommentary(row, editMode, lang) {
  if (lang === 'ar')
    return renderLocalCommentaryLanguage(row, editMode, 'ar');
  if (lang === 'en')
    return renderLocalCommentaryLanguage(row, editMode, 'en');
  const arabic = editMode
    ? renderEditableCommentaryLanguage(row, 'ar')
    : renderCommentaryText(row.text, row.footnotes, commentaryFormat(row.format, 'ar'));
  const english = editMode
    ? renderEditableCommentaryLanguage(row, 'en')
    : renderCommentaryText(row.text_en, row.footnotes_en, commentaryFormat(row.format, 'en'));
  if (arabic && english)
    return `<div class="row quran-tafsir-local-pair"><section class="col-md-6 col-sm-12" lang="en">${english}</section><section class="col-md-6 col-sm-12" lang="ar" dir="rtl">${arabic}</section></div>`;
  const sections = [];
  if (arabic)
    sections.push(`<section lang="ar" dir="rtl">${arabic}</section>`);
  if (english)
    sections.push(`<section lang="en">${english}</section>`);
  return sections.join('\n');
}

function renderLocalCommentaryLanguage(row, editMode, lang) {
  const content = editMode
    ? renderEditableCommentaryLanguage(row, lang)
    : renderCommentaryText(
      lang === 'en' ? row.text_en : row.text,
      lang === 'en' ? row.footnotes_en : row.footnotes,
      commentaryFormat(row.format, lang)
    );
  if (!content)
    return '';
  return lang === 'ar'
    ? `<section lang="ar" dir="rtl">${content}</section>`
    : `<section lang="en">${content}</section>`;
}

function renderEditableCommentaryLanguage(row, lang) {
  const suffix = lang === 'en' ? '_en' : '';
  const format = commentaryFormat(row.format, lang);
  const text = row[`text${suffix}`];
  const footnotes = row[`footnotes${suffix}`];
  return [
    renderEditableCommentaryField(row.id, `text${suffix}`, text, format, lang),
    renderEditableCommentaryField(row.id, `footnotes${suffix}`, footnotes, format, lang)
  ].join('\n');
}

function renderEditableCommentaryField(id, column, text, format, lang) {
  const value = text || '';
  const attrs = `class="_e quran-tafsir-editor${format === 'md' ? '' : ' form-control'}" data-id="${id}" data-prop="commentary.${column}" data-edit-format="${format}"`;
  if (format === 'md')
    return `<div ${attrs} data-markdown-source="${escapeHtml(value)}" data-markdown-empty-html="&hellip;">${renderCommentaryText(value, '', format) || '&hellip;'}</div>`;
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

function renderCommentaryText(text, footnotes, format) {
  if (!text)
    return '';
  const content = [text, footnotes].filter(Boolean).join('\n\n');
  if (format === 'html')
    return markArabicOnlyBlocks(content);
  if (format === 'md')
    return markArabicOnlyBlocks(md.render(content).replace(/<br>/g, '</p><p>'));
  return markArabicOnlyBlocks(md.render(content).replace(/<br>/g, '</p><p>'));
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

function isEditMode(req) {
  return req.cookies.admin == global.settings.admin.key && req.cookies.editMode == 1;
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
