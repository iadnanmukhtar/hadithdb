'use strict';
const {sourceLink: preview, bookFor, collectionForPath, plain, excerpt, qualifiedTitle} = require('./ContentIdentity');
const mysql = require('mysql');
function query(statement, values) {
  return typeof global.query === 'function' ? global.query(mysql.format(statement, values)) : Promise.resolve([]);
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
      if (!plain(row.intro_en)) [row] = await query('SELECT t.title_en,t.title,t.intro_en,t.intro FROM v_toc v JOIN toc t ON t.id=v.id WHERE v.path=? LIMIT 1', [book.alias]);
    } else if (ayah) {
      isAyah = true; book = bookFor('quran');
      const start = Number(ayah[2]), end = Math.min(Number(ayah[3] || start), start + 2);
      const refs = Array.from({length:Math.max(0,end-start+1)},(_,index)=>`${Number(ayah[1])}:${start+index}`);
      if (refs.length) {
        const rows = await query('SELECT title_en,title,body_en,body FROM v_hadiths WHERE book_alias=? AND num IN (?) ORDER BY ordinal LIMIT 3', ['quran', refs]);
        row = {title_en:rows.length === 1 ? rows[0].title_en : '',body_en:rows.map(row=>row.body_en).filter(Boolean).join('\n\n')};
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
      [row] = await query('SELECT t.title_en,t.title,t.intro_en,t.intro FROM v_toc v JOIN toc t ON t.id=v.id WHERE v.path=? LIMIT 1',[headingPath]);
      book = bookFor(headingPath.split('/')[0]);
    }
  } catch (_) { /* Catalog metadata and a reference image remain available if a source is unavailable. */ }
  const body = plain(row?.summary_en || row?.summary || row?.body_en || row?.body || row?.intro_en || row?.intro);
  let heading = plain(row?.title_en || row?.title);
  if(!/[\p{L}\p{N}]/u.test(heading))heading='';
  if (!heading && body && !isAyah && !reference && !collection) {
    const quote = body.match(/[“"«]([^”"»]{24,})[”"»]/);
    heading = excerpt(quote?.[1] || body, 90);
  }
  const title = heading && !collection && !fallback.title.includes(heading) ? excerpt(qualifiedTitle(fallback.title, heading),190) : fallback.title;
  const context = plain(row?.h2_title_en || book?.author_en || book?.author || '');
  const summary = (isAyah || reference) ? (plain(row?.body_en) ? `${fallback.title}: ${excerpt(row.body_en)}` : fallback.description) : (body ? excerpt(body) : context ? excerpt(`${fallback.title}. ${context}`) : fallback.description);
  return {...fallback,imageKind:'icon',title,description:summary,image:fallback.image};
}
module.exports = {preview,enrich,plain,excerpt};
