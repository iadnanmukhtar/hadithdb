'use strict';

const Index = require('./Index');
const { Heading } = require('./Model');
const Utils = require('./Utils');

async function chapter(surah) {
  const rows = await headingsFromIndex(`book_alias:quran AND level:1 AND h1:${Number(surah)}`, 1);
  if (rows.length > 0)
    return rows[0];
  if (typeof global.query !== 'function')
    return null;
  const dbRows = await global.query(`
    SELECT *
    FROM v_toc
    WHERE book_alias='quran'
      AND level=1
      AND h1=${Number(surah)}
    ORDER BY ordinal
    LIMIT 1`);
  return dbRows[0] ? Heading.toLevel(dbRows[0]) : null;
}

async function sectionForAyah(surah, ayah) {
  const headings = await headingsFromIndex(`book_alias:quran AND level:[2 TO 3] AND h1:${Number(surah)}`, 1000);
  let section = matchingSection(headings, ayah);
  if (section || typeof global.query !== 'function')
    return section;

  const dbRows = await global.query(`
    SELECT *
    FROM v_toc
    WHERE book_alias='quran'
      AND level IN (2, 3)
      AND h1=${Number(surah)}
    ORDER BY level, h2, h3, ordinal`);
  section = matchingSection(dbRows.map(row => Heading.toLevel(row)), ayah);
  return section;
}

async function headingsFromIndex(query, size) {
  try {
    return (await Index.docsFromQueryString(Heading.INDEX, query, 0, size, 'level,h2,h3,ordinal'))
      .map(row => Heading.toLevel(row));
  } catch (err) {
    if (!searchBackendUnavailable(err))
      throw err;
    return [];
  }
}

function matchingSection(headings, ayah) {
  const sections = headings.filter(heading => Number(heading.level) === 2);
  const subsections = headings.filter(heading => Number(heading.level) === 3);
  const matchingSubsections = new Set(subsections
    .filter(heading => headingIncludesAyah(heading, ayah))
    .map(heading => Number(heading.h2)));
  const matches = sections.filter(heading => headingIncludesAyah(heading, ayah) || matchingSubsections.has(Number(heading.h2)));
  matches.sort((a, b) => {
    if (matchingSubsections.has(Number(a.h2)) !== matchingSubsections.has(Number(b.h2)))
      return matchingSubsections.has(Number(a.h2)) ? -1 : 1;
    return Number(a.h2) - Number(b.h2);
  });
  return matches[0] || null;
}

function headingIncludesAyah(heading, ayah) {
  const start = ayahFromHeadingStart(heading.start);
  const count = parseInt(heading.count, 10);
  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 1)
    return false;
  return start <= Number(ayah) && start + count - 1 >= Number(ayah);
}

function ayahFromHeadingStart(start) {
  const parts = Utils.trimToEmpty(start).split(/:/);
  return parseInt(parts[parts.length - 1] || '', 10);
}

function searchBackendUnavailable(err) {
  const status = err && (err.status || err.statusCode);
  return [502, 503, 504].includes(Number(status));
}

module.exports = {
  chapter,
  sectionForAyah
};
