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
  const ayah = path.match(/^\/(?:quran\/)?(?:translations\/)?(?:quran:)?(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?\/?$/);
  const tafsir = path.match(/^\/(?:quran\/)?tafsir\/([A-Za-z0-9_-]+)\/quran:(\d{1,3}:\d{1,3}(?:-\d{1,3})?)\/?$/);
  const sharh = path.match(/^\/sharh\/([A-Za-z0-9_-]+)\/(?:heading\/)?([A-Za-z0-9:.\-]+)\/?$/);
  const heading = path.match(/^\/([A-Za-z][A-Za-z0-9_-]*)\/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\/?$/);
  const tafsirHeading = path.match(/^\/(?:quran\/)?tafsir\/([A-Za-z0-9_-]+)\/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\/?$/);
  const reference = path.match(/^\/([A-Za-z][A-Za-z0-9_-]*):([A-Za-z0-9:.\-]+)\/?$/);
  const passage = path.match(/^\/quran\/(\d{1,3})\/(\d+(?:\.\d+)?)\/?$/);
  if (ayah) {
    const surah = (global.surahs || []).find(row => Number(row.num) === Number(ayah[1]));
    title = `${surah?.name_en || 'Quran'} ${ayah[1]}:${ayah[2]}${ayah[3]?'-'+ayah[3]:''}`;
  } else if (tafsir) title = `${titleFor(tafsir[1])} — Quran ${tafsir[2]}`;
  else if (sharh) title = `${titleFor(sharh[1])} — ${sharh[2]}`;
  else if (reference && books.some(book=>book.alias===reference[1])) title = `${titleFor(reference[1])} ${reference[2]}`;
  else if (tafsirHeading) title = `${titleFor(tafsirHeading[1])} — ${tafsirHeading[2]}`;
  else if (heading && books.some(book=>book.alias===heading[1])) title = `${titleFor(heading[1])} — ${heading[2]}`;
  else if (passage) title = `Quran ${passage[1]} — Passage ${passage[2]}`;
  else return null;
  return {url:url.href,title:title.slice(0,300),description:'Read '+title+' on Hadith Unlocked.',image:null,video:null};
}
module.exports = {preview};
