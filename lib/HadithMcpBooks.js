'use strict';

const Tafsir = require('./Tafsir');

const string = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const types = ['quran', 'trans', 'tafsir', 'hadith', 'sharh', 'sirah', 'history'];
const bookFields = {
  alias: string, type: string, roles: { type: 'array', items: string }, virtual: { type: 'boolean' },
  title_arabic: nullableText, title_english: nullableText, author_arabic: nullableText, author_english: nullableText,
  url: string
};
const bookSchema = { type: 'object', properties: bookFields, required: Object.keys(bookFields), additionalProperties: false };
const definitions = [
  {
    name: 'list_books', title: 'List library books',
    description: 'Discover book aliases, authors and reader URLs across the public library. A translation renders Quran wording, a tafsir explains an ayah, and a sharh explains a hadith. Hadith collections include virtual compilations with their own numbering. Sirah and history contain narrative passages. Use lookup_book for a known alias.',
    inputSchema: { type: 'object', properties: {
      type: { type: 'string', enum: types, description: 'Filter by catalog role. Use trans for translations or sharh for hadith commentary. A work may have multiple roles.' },
      query: { type: 'string', minLength: 1, maxLength: 200, description: 'Part of an alias, Arabic or English title, short name, or author.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'Maximum number of books on this page.' },
      offset: { type: 'integer', minimum: 0, default: 0, description: 'Start at zero, then pass next_offset with the same filters.' }
    }, additionalProperties: false },
    outputProperties: { books: { type: 'array', items: bookSchema }, total: { type: 'integer' }, next_offset: { type: ['integer', 'null'] } }
  },
  {
    name: 'lookup_book', title: 'Look up a library book',
    description: 'Resolve an exact catalog alias to its work, author, roles and reader URL. To read text, use lookup_quran_ayah for Quran, lookup_quran_translation for a translator, lookup_tafsir for an exegete, lookup_hadith_detail for a numbered hadith or historical passage, and lookup_hadith_commentary for an entry ID from shuruh search.',
    inputSchema: { type: 'object', properties: {
      alias: { type: 'string', minLength: 1, description: 'Exact work alias from list_books, for example bukhari.' }
    }, required: ['alias'], additionalProperties: false }, outputProperties: { book: bookSchema }
  },
  {
    name: 'lookup_quran_translation', title: 'Look up a Quran translation',
    description: 'Read a specific translator’s English rendering of one ayah. Use list_books with type trans to choose the edition. Preserve the translator’s attribution when citing or comparing wording.',
    inputSchema: { type: 'object', properties: {
      translation: { type: 'string', minLength: 1, description: 'Exact alias of a work listed under the trans role.' },
      surah: { type: 'integer', minimum: 1, maximum: 114, description: 'Surah number containing the requested ayah.' },
      ayah: { type: 'integer', minimum: 0, maximum: 286, description: 'Ayah number within the surah. Zero is valid only in Surah 1.' }
    }, required: ['translation', 'surah', 'ayah'], additionalProperties: false },
    outputProperties: { book: bookSchema, reference: string, url: string, text_english: string }
  }
];

function roles(book) {
  if (book.type === 'tafsir' || book.type === 'trans') return Tafsir.commentaryCatalogRoles(book);
  if (book.type === 'sirah' && book.alias === 'history') return ['sirah', 'history'];
  return [book.type];
}

function describe(book, urls) {
  const alias = encodeURIComponent(book.alias);
  let url = urls.hadith + '/' + alias;
  if (book.type === 'quran') url = urls.quran + '/quran';
  if (book.type === 'trans') url = urls.quran + '/quran/' + alias;
  if (book.type === 'tafsir') url = urls.quran + '/quran/tafsir/' + Tafsir.tafsirSlug(book.alias);
  if (book.type === 'sharh') url = urls.hadith + '/sharh/' + alias;
  return { alias: book.alias, type: book.type, roles: roles(book), virtual: Number(book.virtual) === 1,
    title_arabic: book.title || book.name || null, title_english: book.title_en || book.name_en || null,
    author_arabic: book.author || null, author_english: book.author_en || null, url };
}

async function call(name, args, urls, helpers) {
  if (!Array.isArray(global.books) || global.books.some(book => book.id === -1 && book.alias === 'none'))
    throw new Error('Library catalog is not loaded.');
  const books = global.books.filter(book => book.type && (book.type === 'sharh' || Number(book.hidden) !== 1));
  if (name === 'list_books') {
    const query = (args.query || '').trim().toLowerCase();
    const matches = books.filter(book => (!args.type || roles(book).includes(args.type)) &&
      [book.alias, book.title, book.title_en, book.name, book.name_en, book.shortName, book.shortName_en,
        book.author, book.author_en, book.authorShortName, book.authorShortName_en].some(value => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => a.alias.localeCompare(b.alias));
    const offset = args.offset || 0, end = offset + (args.limit || 25);
    return { books: matches.slice(offset, end).map(book => describe(book, urls)), total: matches.length, next_offset: end < matches.length ? end : null };
  }
  const alias = (args.translation || args.alias).trim();
  const book = books.find(row => row.alias === alias);
  if (!book) throw new Error('Unknown book alias. Use list_books to find the work.');
  if (name === 'lookup_book') return { book: describe(book, urls) };
  if (!roles(book).includes('trans')) throw new Error('Choose a translation alias from list_books with type trans.');
  if (args.ayah === 0 && args.surah !== 1) throw new Error('Ayah 0 is valid only for Surah 1.');
  const reference = `quran:${args.surah}:${args.ayah}`;
  const url = `${urls.quran}/quran/${encodeURIComponent(alias)}/${reference}`;
  let text;
  if (book.source === 'default') {
    const result = await helpers.lookupAyah(args.surah, args.ayah);
    text = result.structuredContent.ayah.english.body;
  } else {
    const entry = await Tafsir.localTranslationEntry({ ...book, type: 'trans' }, args.surah, args.ayah);
    if (entry) text = helpers.htmlToText(entry.html);
  }
  if (!text) throw new Error(`No translation text available from ${alias} for ${reference}.`);
  return { book: describe(book, urls), reference, url, text_english: text };
}

module.exports = { DEFINITIONS: definitions, call };
