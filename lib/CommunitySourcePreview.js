'use strict';
// Source links have enough catalog metadata to render a card without fetching a
// potentially very large reader page. This path never makes network requests.
function preview(value) {
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return null;
  const site = global.settings?.site || {};
  const origins = [site.url, site.quranUrl, global.settings?.blog?.url].filter(Boolean).flatMap(value => {try{return [new URL(value).origin];}catch{return [];}});
  const local = /^(?:localhost|[\w-]+\.localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (!origins.includes(url.origin) && !local) return null;
  let path;
  try { path = decodeURIComponent(url.pathname); } catch (_) { return null; }
  const books = global.books || [];
  const titleFor = alias => {const book=books.find(book=>book.alias===alias);return book?.shortName_en || book?.name_en || book?.title_en || alias;};
  let title;
  const collection = collectionForPath(path);
  const ayah = path.match(/^\/(?:quran\/)?(?:translations\/)?(?:quran:)?(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?\/?$/);
  const tafsir = path.match(/^\/(?:quran\/)?tafsir\/([A-Za-z0-9_-]+)\/quran:(\d{1,3}:\d{1,3}(?:-\d{1,3})?)\/?$/);
  const sharh = path.match(/^\/sharh\/([A-Za-z0-9_-]+)\/(?:heading\/)?([A-Za-z0-9:.\-]+)\/?$/);
  const heading = path.match(/^\/([A-Za-z][A-Za-z0-9_-]*)\/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\/?$/);
  const tafsirHeading = path.match(/^\/(?:quran\/)?tafsir\/([A-Za-z0-9_-]+)\/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\/?$/);
  const reference = path.match(/^\/([A-Za-z][A-Za-z0-9_-]*):([A-Za-z0-9:.\-]+)\/?$/);
  const passage = path.match(/^\/quran\/(\d{1,3})\/(\d+(?:\.\d+)?)\/?$/);
  if (collection) title = collection.name_en || collection.title_en || collection.shortName_en || collection.alias;
  else if (ayah) {
    const surah = (global.surahs || []).find(row => Number(row.num) === Number(ayah[1]));
    title = `${surah?.name_en || 'Quran'} ${ayah[1]}:${ayah[2]}${ayah[3]?'-'+ayah[3]:''}`;
  } else if (tafsir) title = `${titleFor(tafsir[1])} — Quran ${tafsir[2]}`;
  else if (sharh) title = `${titleFor(sharh[1])} — ${sharh[2]}`;
  else if (reference && books.some(book=>book.alias===reference[1])) title = `${titleFor(reference[1])} ${reference[2]}`;
  else if (tafsirHeading) title = `${titleFor(tafsirHeading[1])} — ${tafsirHeading[2]}`;
  else if (heading && books.some(book=>book.alias===heading[1])) title = `${titleFor(heading[1])} — ${heading[2]}`;
  else if (passage) title = `Quran ${passage[1]} — Passage ${passage[2]}`;
  else return null;
  const quran = Boolean(ayah || tafsir || tafsirHeading || passage || path.startsWith('/quran/') || (site.quranUrl && url.origin === new URL(site.quranUrl).origin));
  const image = quran ? '/static/img/quran-apple-touch-icon.png' : '/static/img/apple-touch-icon.png';
  return {url:url.href,title:title.slice(0,300),description:'Read '+title+' on Hadith Unlocked.',image,imageKind:'icon',video:null,source:true};
}

const markdown = require('markdown-it')({html:true,breaks:true});
const {load} = require('cheerio');
const mysql = require('mysql');
function plain(value) {
  const html = markdown.render(String(value || '').replace(/^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, '').replace(/\[\^[^\]]+\]/g, ''));
  const $ = load(html, null, false);
  $('script,style,nav,form,.footnote-ref,.footnotes,.footnote-backref').remove();
  $('p,li,br,h1,h2,h3,blockquote').append(' ');
  return $.text().replace(/\s+/g, ' ').trim();
}
function excerpt(value, limit = 360) {
  const text = plain(value);
  if (Array.from(text).length <= limit) return text;
  const part = Array.from(text).slice(0, limit + 1).join('');
  return (part.replace(/\s+\S*$/, '') || Array.from(text).slice(0, limit).join('')).trimEnd() + '…';
}
function query(statement, values) {
  return typeof global.query === 'function' ? global.query(mysql.format(statement, values)) : Promise.resolve([]);
}
function bookFor(alias) {
  return (global.books || []).find(book => book.alias === alias || book.slug === alias)
    || (global.commentaries || []).find(book => book.alias === alias || book.slug === alias);
}
function collectionForPath(path) {
  const match = path.match(/^\/(?:quran\/(?:tafsir|translations)\/|sharh\/)?([A-Za-z][A-Za-z0-9_-]*)\/?$/);
  return match ? bookFor(match[1]) : null;
}
function coverFor(book, url) {
  let properties = book?.properties || {};
  if (typeof properties === 'string') {try{properties=JSON.parse(properties);}catch{properties={};}}
  for (const value of [book?.cover, book?.cover_url, properties.cover, properties.cover_url]) {
    if(typeof value !== 'string' || !value.trim())continue;
    try {
      const image = new URL(value, url);
      if (value && (image.protocol === 'https:' || image.origin === new URL(url).origin && image.protocol === 'http:') && !image.username && !image.password) return image.href;
    } catch (_) { /* Try the next source artwork field. */ }
  }
  return null;
}
async function enrich(value) {
  const fallback = preview(value);
  if (!fallback) return null;
  const url = new URL(value), path = decodeURIComponent(url.pathname);
  let row, book, isAyah = false;
  const collection = collectionForPath(path);
  const ayah = path.match(/^\/(?:quran\/)?(?:translations\/)?(?:quran:)?(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?\/?$/);
  const reference = path.match(/^\/([A-Za-z][A-Za-z0-9_-]*):([A-Za-z0-9:.\-]+)\/?$/);
  const sharh = path.match(/^\/sharh\/([A-Za-z0-9_-]+)\/(heading\/)?([A-Za-z0-9:.\-]+)\/?$/);
  const tafsir = path.match(/^\/(?:quran\/)?tafsir\/([A-Za-z0-9_-]+)\/quran:(\d{1,3}):(\d{1,3})(?:-\d{1,3})?\/?$/);
  try {
    if (collection) {
      book = collection;
      row = {intro_en:book.description_en || book.description};
      if (!plain(row.intro_en)) [row] = await query('SELECT title_en,title,intro_en,intro FROM v_toc WHERE path=? LIMIT 1', [book.alias]);
    } else if (ayah) {
      isAyah = true; book = bookFor('quran');
      const start = Number(ayah[2]), end = Math.min(Number(ayah[3] || start), start + 2);
      const refs = Array.from({length:Math.max(0,end-start+1)},(_,index)=>`${Number(ayah[1])}:${start+index}`);
      if (refs.length) {
        const rows = await query('SELECT title_en,title,body_en,body FROM v_hadiths WHERE book_alias=? AND num IN (?) ORDER BY ordinal LIMIT 3', ['quran', refs]);
        row = {body_en:rows.map(row=>row.body_en || row.body).filter(Boolean).join('\n\n')};
      }
    } else if (reference) {
      book = bookFor(reference[1]);
      const table = Number(book?.virtual) === 1 ? 'v_hadiths_virtual_snapshot' : 'v_hadiths';
      [row] = await query(`SELECT title_en,title,body_en,body,h2_title_en FROM ${table} WHERE book_alias=? AND num=? LIMIT 1`, [reference[1], reference[2]]);
    } else if (sharh) {
      const Sharh = require('./Sharh');
      const data = sharh[2] ? await Sharh.entryById(sharh[3], 'heading') : await Sharh.entryByReference(sharh[1], sharh[3]);
      if (data?.book.alias === sharh[1]) {book=data.book;row={body_en:data.entry.text_en,body:data.entry.text};}
    } else if (tafsir) {
      const Tafsir = require('./Tafsir');
      book = await Tafsir.resolveTafsir(tafsir[1]);
      // Remote-only commentary retains a catalog card rather than adding another network dependency.
      if (book?.source === 'local') {
        const rows = await Tafsir.tafsirEntries(book,Number(tafsir[2]),Number(tafsir[3]));
        row = {body_en:rows.map(entry=>entry.translationHtml || entry.html).filter(Boolean).join('\n\n')};
      }
    } else {
      const headingPath = path.replace(/^\//,'').replace(/\/$/,'');
      [row] = await query('SELECT title_en,title,intro_en,intro FROM v_toc WHERE path=? LIMIT 1',[headingPath]);
      book = bookFor(headingPath.split('/')[0]);
    }
  } catch (_) { /* Catalog metadata and a reference image remain available if a source is unavailable. */ }
  const body = plain(row?.summary_en || row?.summary || row?.body_en || row?.body || row?.intro_en || row?.intro);
  let heading = plain(row?.title_en || row?.title);
  if(!/[\p{L}\p{N}]/u.test(heading))heading='';
  if (!heading && body && !isAyah && !collection) {
    const quote = body.match(/[“"«]([^”"»]{24,})[”"»]/);
    heading = excerpt(quote?.[1] || body, 90);
  }
  const title = heading && !isAyah && !collection && !fallback.title.includes(heading) ? excerpt(`${fallback.title} — ${heading}`,190) : fallback.title;
  const context = plain(row?.h2_title_en || book?.author_en || book?.author || '');
  const cover = coverFor(book,url.href);
  return {...fallback,imageKind:cover ? 'cover' : 'icon',title,description:body ? excerpt(body) : context ? excerpt(`${fallback.title}. ${context}`) : fallback.description,image:cover || fallback.image};
}
function escapeXml(value) {return String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));}
function image(value, fallback) {
  const data = preview(value) || fallback;
  if (!data) return null;
  const lines = [], words = data.title.split(/\s+/);let line='';
  for(const word of words){if((line+' '+word).trim().length>32 && line){lines.push(line);line='';}line+=(line?' ':'')+word;}
  if(line)lines.push(line);
  const visible = lines.slice(0,3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#142c4a"/><stop offset="1" stop-color="#204f76"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><circle cx="1120" cy="40" r="300" fill="#2c9be5" opacity=".13"/><path d="M80 190h60c30 0 50 12 60 24 10-12 30-24 60-24h60v130h-60c-28 0-46 8-60 24-14-16-32-24-60-24H80zM200 214v130" fill="none" stroke="#75c8ff" stroke-width="9" stroke-linejoin="round"/><text x="80" y="105" fill="#b9dff8" font-family="Arial,sans-serif" font-size="25" letter-spacing="5">${escapeXml(data.brand || 'HADITH UNLOCKED')}</text><text x="365" y="${visible.length>2?225:255}" fill="#ffffff" font-family="Georgia,serif" font-size="56">${visible.map((line,index)=>`<tspan x="365" dy="${index?78:0}">${escapeXml(line)}</tspan>`).join('')}</text><rect x="80" y="472" width="1040" height="2" fill="#75c8ff" opacity=".35"/><text x="80" y="540" fill="#c6dfef" font-family="Arial,sans-serif" font-size="26">${escapeXml(new URL(value).pathname.replace(/^\//,''))}</text></svg>`;
}
module.exports = {preview,enrich,image,plain,excerpt};
