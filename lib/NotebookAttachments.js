'use strict';
const createError = require('http-errors');

// Store public reference identities, never search-result HTML or external URLs.
function parse(value = []) {
  if (!Array.isArray(value) || value.length > 50) throw createError(400, 'Attach up to 50 references to a note.');
  const references = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object'
      || typeof entry.ref !== 'string' || !entry.ref.trim() || entry.ref.length > 500
      || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 500
      || typeof entry.url !== 'string' || entry.url.length > 1000
      || !/^\/(?!\/)/.test(entry.url) || /[\\\x00-\x20]/.test(entry.url)) {
      throw createError(400, 'Invalid note reference.');
    }
    const url = new URL(entry.url, 'https://notebook.local');
    if (url.origin !== 'https://notebook.local') throw createError(400, 'Invalid note reference.');
    references.set(entry.url, { ref: entry.ref.trim(), label: entry.label.trim(), url: entry.url });
  }
  return [...references.values()];
}
async function search(query) {
  if (typeof query !== 'string' || query.length > 500) throw createError(400, 'Invalid reference search.');
  if (query.trim().length < 2) return [];
  const canonical = query.trim().toLowerCase();
  const exact = /^(?:quran:\d{1,3}:\d{1,3}|[a-z][a-z0-9_-]*:\d+[a-z]?)$/.test(canonical)
    ? canonical : require('./Books').findReference(query, global.books)?.ref;
  if (exact) {
    let item;
    try { item = await require('./Model').Item.itemFromRef(exact); }
    catch (err) { if (err instanceof ReferenceError) return []; throw err; }
    if (!item || item.ref !== exact) return [];
    return [{ref: exact, label: exact, url: `/${exact}`, title: exact,
      type: exact.startsWith('quran:') ? 'Ayah' : 'Hadith',
      fragment: item.body_en || item.body || '', metadata_en: item.book_shortName_en || '', metadata_ar: item.book_shortName || ''}];
  }
  const suggestions = await require('./Search').a_autocomplete(query, [], 12);
  return suggestions.filter(item => item.ref && item.url && item.type !== 'Book').map(item => ({
    ...parse([{ ref: item.ref, label: item.ref, url: item.url }])[0],
    title: item.label, type: item.type, fragment: item.fragment || '',
    metadata_en: item.metadata_en || '', metadata_ar: item.metadata_ar || ''
  }));
}
module.exports = { parse, search };
