'use strict';

const labels = require('../public/static/js/content-labels');
const markdown = require('markdown-it')({ html: true });
const { load } = require('cheerio');

function plain(value) {
  const html = markdown.render(String(value || '').replace(/^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, '').replace(/\[\^[^\]]+\]/g, ''));
  const $ = load(html, null, false);
  $('script,style,nav,form,.footnotes,.footnote-ref,.footnote-backref').remove();
  $('p,div,li,br,h1,h2,h3,h4,h5,h6,blockquote,pre').append(' ');
  return $.text().replace(/\s+/g, ' ').trim();
}

function excerpt(value, limit = 360) {
  const text = plain(value);
  if (Array.from(text).length <= limit) return text;
  const part = Array.from(text).slice(0, limit).join('');
  return (part.replace(/\s+\S*$/, '') || part).trimEnd() + '…';
}

// Pure presentation rules: callers provide already-authorized content. No I/O.
function title(heading, body, fallback = '') {
  const name = plain(heading);
  if (name) return name;
  const words = plain(body).split(/\s+/).filter(Boolean);
  return Array.from(words.slice(0, 8).join(' ')).slice(0, 240).join('')
    + (words.length > 8 ? '…' : '') || fallback;
}
function postTitle(heading, body, kind = 'note') {
  return title(heading, body, kind === 'article' ? 'Untitled article' : 'Post');
}
function authoredTitle(value, author) {
  const heading = title(value, '', 'Post'), name = plain(author);
  return name ? (heading === 'Post' ? `Post by ${name}` : `${heading} — ${name}`) : heading;
}
function reference(value, {content = false} = {}) {
  let path = String(value || '').trim();
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch (_) { return ''; }
  }
  path = path.split(/[?#]/)[0].replace(/^\//, '');
  return content ? path.replace(/^(?:sharh\/|quran\/tafsir\/)/, '') : path;
}
function label(name, ref) {
  return labels.label(plain(name), plain(ref));
}
function qualifiedTitle(ref, heading) {
  const name = plain(heading), source = plain(ref);
  return labels.qualifiedTitle(source, name);
}
function subject(source) {
  return [plain(source.title), plain(source.reference)].filter(Boolean).join(' · ');
}
function activity(row) {
  const url = row.source_url;
  return {title: title(row.source_title, row.source_text, 'a source passage'),
    reference: reference(row.type === 'content' ? url : row.ref_num, {content: row.type === 'content'}),
    ...(url ? {url} : {})};
}
// Source links have enough catalog metadata to render a card without fetching a
// potentially very large reader page. This path never makes network requests.
function sourceLink(value) {
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return null;
  const site = global.settings?.site || {};
  const origins = [site.url, site.quranUrl, global.settings?.blog?.url, 'https://hadithunlocked.com', 'https://quranunlocked.com', 'https://quran.islamunlocked.com', 'https://hadith.islamunlocked.com'].filter(Boolean).flatMap(value => {try{return [new URL(value).origin];}catch{return [];}});
  const local = /^(?:localhost|[\w-]+\.localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (!origins.includes(url.origin) && !local) return null;
  let path;
  try { path = decodeURIComponent(url.pathname); } catch (_) { return null; }
  const books = global.books || [];
  const titleFor = alias => {const book=bookFor(alias);return book?.name_en || book?.title_en || book?.shortName_en || alias;};
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
    title = label(surah?.name_en || 'Quran', `${ayah[1]}:${ayah[2]}${ayah[3]?'-'+ayah[3]:''}`);
  } else if (tafsir) title = `${titleFor(tafsir[1])} — Quran ${tafsir[2]}`;
  else if (sharh) title = `${titleFor(sharh[1])} — ${sharh[2]}`;
  else if (reference && books.some(book=>book.alias===reference[1])) title = label(titleFor(reference[1]), reference[2]);
  else if (tafsirHeading) title = `${titleFor(tafsirHeading[1])} — ${tafsirHeading[2]}`;
  else if (heading && books.some(book=>book.alias===heading[1])) title = `${titleFor(heading[1])} — ${heading[2]}`;
  else if (passage) title = `Quran ${passage[1]} — Passage ${passage[2]}`;
  else return null;
  const quran = Boolean(ayah || tafsir || tafsirHeading || passage || path.startsWith('/quran/') || (site.quranUrl && url.origin === new URL(site.quranUrl).origin));
  const image = quran ? '/static/img/quran-apple-touch-icon.png' : '/static/img/apple-touch-icon.png';
  return {url:url.href,title:title.slice(0,300),description:'Read '+title+' on Hadith Unlocked.',image,imageKind:'icon',video:null,source:true};
}


function bookFor(alias) {
  return (global.books || []).find(book => book.alias === alias || book.slug === alias)
    || (global.commentaries || []).find(book => book.alias === alias || book.slug === alias);
}
function collectionForPath(path) {
  const match = path.match(/^\/(?:quran\/(?:tafsir|translations)\/|sharh\/)?([A-Za-z][A-Za-z0-9_-]*)\/?$/);
  return match ? bookFor(match[1]) : null;
}

// Reader context is explicit: a section, selected ayat, and a translation
// comparison are different pages, but share the same source/reference rules.
function quranReaderTitle({surah, reference, heading, section, selectionCount = 1, author, translations = false}) {
  const parts = selectionCount === 0
    ? [label('Surah', surah) + ' §' + plain(section), author, heading]
    : [label(label('Surah', surah), reference), selectionCount > 1 ? label('§' + plain(section), heading) : heading];
  if (translations) parts.push('Quran Translations');
  return labels.join(parts.map(plain), ' | ');
}
function tafsirReaderTitle({name, section, reference}) {
  return labels.join([label('Tafsir', plain(name).replace(/^Tafsir\s+/i, '')) + (section ? ' §' + plain(section) : ''), label('Ayat', reference)], ' | ');
}
module.exports = {quranReaderTitle, tafsirReaderTitle, range: labels.range, join: (parts, separator = ' | ') => labels.join(parts.map(plain), separator), sourceLink, bookFor, collectionForPath, plain, excerpt, title, postTitle, authoredTitle, reference, label, qualifiedTitle, subject, activity};
