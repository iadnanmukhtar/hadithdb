'use strict';

function title(heading = {}, book = {}) {
  const level = Number(heading.level || (heading.h3 ? 3 : heading.h2 ? 2 : 1));
  const name = book.shortName_en || book.name_en || book.shortName || book.name
    || heading.book_shortName_en || heading.book_name_en || heading.book_shortName || heading.book_alias || book.alias;
  const headingTitle = heading.title_en || heading.title || heading[`h${level}_title_en`] || heading[`h${level}_title`];
  const numbers = [heading.h1, ...(level >= 2 ? [heading.h2] : []), ...(level >= 3 ? [heading.h3] : [])];
  const number = numbers.filter(value => value !== null && value !== undefined && value !== '').join('.');
  const context = number ? `${level === 1 ? 'Chapter' : level === 3 ? 'Subsection' : 'Section'} ${number}` : heading.path;
  return ['Introduction', name, [context, headingTitle].filter(Boolean).join(' — ')].filter(Boolean).join(' — ').slice(0, 500);
}

async function resolve(notes) {
  const ids = [...new Set(notes.map(note => /^intro:(\d+)$/.exec(note?.source_key || '')?.[1]).filter(Boolean))];
  if (!ids.length) return notes;
  const rows = await global.query(`SELECT * FROM v_toc WHERE id IN (${ids.map(Number).join(',')})`);
  const titles = new Map(rows.map(row => [`intro:${row.id}`, title(row)]));
  return notes.map(note => titles.has(note?.source_key) ? { ...note, source_title: titles.get(note.source_key) } : note);
}

module.exports = { title, resolve };
