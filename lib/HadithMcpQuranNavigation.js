'use strict';

const Index = require('./Index');
const { Heading } = require('./Model');
const QuranMushaf = require('./QuranMushaf');
const Utils = require('./Utils');

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function text(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function reference(surah, start, end) {
  return `quran:${surah}:${start}${start === end ? '' : `-${end}`}`;
}

function heading(row, baseUrl, maxChars) {
  const level = Number(row.level);
  const field = key => row[`h${level}_${key}`] ?? row[key];
  const startParts = String(field('start') || '').split(':');
  const surah = Number(row.h1);
  const start = Number(startParts[1]);
  const count = Number(field('count'));
  if (![2, 3].includes(level) || startParts.length !== 2 || Number(startParts[0]) !== surah ||
      !Number.isInteger(start) || start < 0 || (start === 0 && surah !== 1) || !Number.isInteger(count) || count < 1)
    throw new Error('Quran heading has an invalid stored ayah range.');
  const section = Number(row.h2);
  const subsection = level === 3 ? Number(row.h3) : null;
  let truncated = false;
  const bounded = value => {
    const result = text(value);
    if (result && result.length > maxChars) {
      truncated = true;
      return result.slice(0, maxChars);
    }
    return result;
  };
  const introArabic = bounded(field('intro'));
  const introEnglish = bounded(field('intro_en'));
  return {
    key: `${surah}.${section}${subsection === null ? '' : `.${subsection}`}`,
    level, surah, section, subsection,
    title_arabic: text(field('title')), title_english: text(field('title_en')),
    introduction_arabic: introArabic, introduction_english: introEnglish,
    introduction_scope: 'Full stored passage or subsection, which may extend beyond the requested page.',
    truncated,
    ayah_from: start, ayah_to: start + count - 1,
    reference: reference(surah, start, start + count - 1),
    url: `${baseUrl}${Utils.quranStudySectionPath({ surah, section, subsection })}`
  };
}

async function headings(surahNumbers, baseUrl, profile) {
  const rows = [];
  const size = 500;
  const fields = ['level', 'h1', 'h2', 'h3', 'ordinal', 'start', 'count', 'title', 'title_en', 'intro', 'intro_en'];
  for (const level of [2, 3])
    fields.push(...['start', 'count', 'title', 'title_en', 'intro', 'intro_en'].map(field => `h${level}_${field}`));
  let page;
  do {
    page = await Index.docsFromQueryFields(Heading.INDEX, { bool: { filter: [
      { term: { book_alias: 'quran' } }, { terms: { h1: surahNumbers } }, { terms: { level: [2, 3] } }
    ] } }, fields, rows.length, size, 'h1,h2,h3,ordinal');
    rows.push(...page);
  } while (page.length === size);
  const maxChars = profile === 'full' ? Infinity : profile === 'compact' ? 1000 : 6000;
  return rows.map(row => heading(row, baseUrl, maxChars)).sort((a, b) =>
    a.surah - b.surah || a.section - b.section || a.level - b.level || (a.subsection || 0) - (b.subsection || 0));
}

async function listSections(args, baseUrl) {
  const surah = integer(args.surah, 'surah', 1, 114);
  const offset = integer(args.offset ?? 0, 'offset', 0, 10000);
  const limit = integer(args.limit ?? 25, 'limit', 1, 100);
  const all = await headings([surah], baseUrl, args.response_profile);
  if (!all.length)
    throw new Error(`No Quran sections were found for surah ${surah}.`);
  if (offset >= all.length && offset !== 0)
    throw new Error('Section offset is beyond the available headings.');
  return {
    surah, url: `${baseUrl}/quran/${surah}`, total: all.length,
    offset, has_more: offset + limit < all.length,
    next_offset: offset + limit < all.length ? offset + limit : null,
    headings: all.slice(offset, offset + limit)
  };
}

async function passage(args, baseUrl) {
  const surah = integer(args.surah, 'surah', 1, 114);
  if ((args.section === undefined) === (args.ayah === undefined))
    throw new Error('Specify exactly one of section or ayah.');
  if (args.subsection !== undefined && args.section === undefined)
    throw new Error('subsection requires section.');
  if (args.section !== undefined) integer(args.section, 'section', 1, 1000);
  if (args.subsection !== undefined) integer(args.subsection, 'subsection', 1, 1000);
  if (args.ayah !== undefined) integer(args.ayah, 'ayah', surah === 1 ? 0 : 1, 286);
  const all = await headings([surah], baseUrl, args.response_profile);
  const matches = all.filter(item => args.section !== undefined
    ? item.section === args.section && (args.subsection === undefined ? item.level === 2 : item.subsection === args.subsection)
    : item.level === 2 && item.ayah_from <= args.ayah && item.ayah_to >= args.ayah);
  if (matches.length !== 1)
    throw new Error('Quran passage was not found or its range is ambiguous. Use list_quran_sections to select a section.');
  const selected = matches[0];
  const children = selected.level === 2 ? all.filter(item => item.level === 3 && item.section === selected.section) : [];
  const parent = selected.level === 3 ? all.find(item => item.level === 2 && item.section === selected.section) || null : null;
  const [first, last] = await Promise.all([
    QuranMushaf.pageForRef(surah, Math.max(1, selected.ayah_from)),
    QuranMushaf.pageForRef(surah, Math.max(1, selected.ayah_to), { last: true })
  ]);
  return { passage: selected, parent, subsections: children,
    first_page: first, last_page: last,
    mushaf_url: first ? `${baseUrl}/quran/page/${first}?ayah=${surah}:${Math.max(1, selected.ayah_from)}${selected.ayah_to > Math.max(1, selected.ayah_from) ? `-${selected.ayah_to}` : ''}` : null };
}

async function page(args, baseUrl) {
  if ((args.page === undefined) === (args.surah === undefined))
    throw new Error('Specify either page, or surah and ayah.');
  let number = args.page;
  if (number !== undefined) {
    integer(number, 'page', 1, 604);
    if (args.ayah !== undefined) throw new Error('ayah requires surah, not page.');
  } else {
    const surah = integer(args.surah, 'surah', 1, 114);
    const ayah = integer(args.ayah, 'ayah', 1, 286);
    number = await QuranMushaf.pageForRef(surah, ayah);
    if (!number) throw new Error('No Mushaf page was found for this ayah.');
  }
  const data = await QuranMushaf.page(number);
  if (!data) throw new Error(`Mushaf page ${number} was not found.`);
  const ayahs = new Map();
  for (const word of data.lines.flatMap(line => line.words || []).filter(word => !word.is_ayah_marker)) {
    const ref = `quran:${word.surah}:${word.ayah}`;
    if (!ayahs.has(ref)) ayahs.set(ref, { reference: ref, surah: Number(word.surah), ayah: Number(word.ayah), first_word: null, last_word: null });
    const item = ayahs.get(ref);
    if (Number.isInteger(Number(word.word)) && Number(word.word) > 0) {
      item.first_word = item.first_word === null ? Number(word.word) : Math.min(item.first_word, Number(word.word));
      item.last_word = item.last_word === null ? Number(word.word) : Math.max(item.last_word, Number(word.word));
    }
  }
  if (!ayahs.size) throw new Error('No Quran ayah mappings are available for this page.');
  const references = [...ayahs.values()];
  const surahs = [...new Set(references.map(item => item.surah))];
  const ranges = surahs.map(surah => {
    const values = references.filter(item => item.surah === surah).map(item => item.ayah);
    return { surah, ayah_from: Math.min(...values), ayah_to: Math.max(...values) };
  });
  const all = await headings(surahs, baseUrl, args.response_profile);
  const overlapping = all.filter(item => ranges.some(range => range.surah === item.surah && range.ayah_from <= item.ayah_to && range.ayah_to >= item.ayah_from));
  return {
    page: number, url: `${baseUrl}/quran/page/${number}`,
    mushaf: { name: text(data.info.name), total_pages: Number(data.info.number_of_pages), lines_per_page: Number(data.info.lines_per_page) },
    previous_page: number > 1 ? number - 1 : null,
    next_page: number < Number(data.info.number_of_pages) ? number + 1 : null,
    ranges, ayahs: references,
    page_boundary_note: 'Ayahs can span pages. first_word and last_word identify the words present here; ranges alone do not imply complete ayahs.',
    summary: {
      kind: 'stored_heading_outline',
      text_english: overlapping.map(item => item.title_english ? `${item.reference}: ${item.title_english}` : null).filter(Boolean).join('\n') || null,
      text_arabic: overlapping.map(item => item.title_arabic ? `${item.reference}: ${item.title_arabic}` : null).filter(Boolean).join('\n') || null,
      note: 'Overview assembled from stored passage/subsection headings, not a separately authored page summary or Quran text. Heading ranges and introductions can extend beyond this page.'
    },
    headings: overlapping
  };
}

const string = { type: 'string' };
const number = { type: 'integer' };
const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['integer', 'null'] };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
const headingSchema = object({
  key: string, level: { type: 'integer', enum: [2, 3] }, surah: number, section: number, subsection: nullableNumber,
  title_arabic: nullableString, title_english: nullableString,
  introduction_arabic: nullableString, introduction_english: nullableString,
  introduction_scope: string, truncated: { type: 'boolean' },
  ayah_from: number, ayah_to: number, reference: string, url: string
});
const profile = { type: 'string', enum: ['compact', 'default', 'full'], default: 'default', description: 'Per-heading introduction limits: compact 1000 characters per language, default 6000, full all stored text. Titles and ranges are always preserved.' };
const surahInput = { type: 'integer', minimum: 1, maximum: 114 };
const DEFINITIONS = [
  {
    name: 'lookup_quran_page', title: 'Look up Quran page',
    description: 'Get a Mushaf page by page number, or find the first page containing a surah and ayah. Returns edition information, ayah/word boundaries, all overlapping passage and subsection headings, stored introductions, and a page overview assembled from those headings. The overview is not a separately authored summary or Quran text. Ayahs and passages may continue across pages.',
    inputSchema: { type: 'object', properties: {
      page: { type: 'integer', minimum: 1, maximum: 604 }, surah: surahInput,
      ayah: { type: 'integer', minimum: 1, maximum: 286 }, response_profile: profile
    }, oneOf: [{ required: ['page'], not: { anyOf: [{ required: ['surah'] }, { required: ['ayah'] }] } },
      { required: ['surah', 'ayah'], not: { required: ['page'] } }], additionalProperties: false },
    outputProperties: {
      page: number, url: string,
      mushaf: object({ name: nullableString, total_pages: number, lines_per_page: number }),
      previous_page: nullableNumber, next_page: nullableNumber,
      ranges: array(object({ surah: number, ayah_from: number, ayah_to: number })),
      ayahs: array(object({ reference: string, surah: number, ayah: number, first_word: nullableNumber, last_word: nullableNumber })),
      page_boundary_note: string,
      summary: object({ kind: { type: 'string', enum: ['stored_heading_outline'] }, text_english: nullableString, text_arabic: nullableString, note: string }),
      headings: array(headingSchema)
    }, handler: page
  },
  {
    name: 'list_quran_sections', title: 'List Quran sections',
    description: 'List a surah’s passage (level 2) and subsection (level 3) headings in hierarchy order, with exact section identities, Arabic/English titles, stored introductions, ayah ranges, and URLs. These editorial headings and introductions are distinct from Quran text. Follow next_offset for more results.',
    inputSchema: { type: 'object', properties: {
      surah: surahInput, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 }, response_profile: profile
    }, required: ['surah'], additionalProperties: false },
    outputProperties: { surah: number, url: string, total: number, offset: number, has_more: { type: 'boolean' }, next_offset: nullableNumber, headings: array(headingSchema) },
    handler: listSections
  },
  {
    name: 'lookup_quran_passage', title: 'Look up Quran passage',
    description: 'Get an exact Quran passage by surah and section number, optionally subsection; or find the passage containing a surah and ayah. Returns stored bilingual headings/introductions, exact ayah ranges, parent/subsection relationships, and Mushaf links. A section number is an editorial passage identifier, not an ayah number. Use list_quran_sections to discover section IDs.',
    inputSchema: { type: 'object', properties: {
      surah: surahInput, section: { type: 'integer', minimum: 1, maximum: 1000 },
      subsection: { type: 'integer', minimum: 1, maximum: 1000 },
      ayah: { type: 'integer', minimum: 0, maximum: 286, description: 'Ayah 0 is valid only in surah 1.' }, response_profile: profile
    }, required: ['surah'], oneOf: [
      { required: ['section'], not: { required: ['ayah'] } },
      { required: ['ayah'], not: { anyOf: [{ required: ['section'] }, { required: ['subsection'] }] } }
    ], additionalProperties: false },
    outputProperties: { passage: headingSchema, parent: { anyOf: [headingSchema, { type: 'null' }] }, subsections: array(headingSchema), first_page: nullableNumber, last_page: nullableNumber, mushaf_url: nullableString },
    handler: passage
  }
];

module.exports = { listSections, passage, page, DEFINITIONS };
