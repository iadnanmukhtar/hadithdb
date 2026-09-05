// @ts-check
'use strict';

const Utils = require('./Utils');

const SERVER_NAME = 'HadithDB';
const SERVER_VERSION = '0.2.0';
const PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const FETCH_TIMEOUT_MS = 30000;
const SEARCH_PAGE_SIZE = 20;
const MAX_TAFSIR_SEARCH_PAGES = 5;

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
});

const TOOLS = Object.freeze([
  tool('lookup_quran_ayah', 'Look up Quran ayah',
    'Retrieve the Arabic text, English translation, headings, and canonical URL for one Quran ayah by numeric reference.', {
      type: 'object',
      properties: {
        surah: { type: 'integer', minimum: 1, maximum: 114, description: 'Surah number, 1 through 114.' },
        ayah: { type: 'integer', minimum: 0, description: 'Ayah number. Ayah 0 is valid only for Surah 1.' }
      },
      required: ['surah', 'ayah'],
      additionalProperties: false
    }),
  tool('search_quran', 'Search Quran',
    'Search Quran Arabic text and English translations by words or phrases. Use lookup_quran_ayah for an exact reference.',
    searchInputSchema({ sort: true })),
  tool('list_tafsirs', 'List tafsirs',
    'Find available HadithDB tafsir sources and aliases. Use this to resolve an author or title before a tafsir lookup.', {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional author, title, language, or alias filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }
      },
      additionalProperties: false
    }),
  tool('lookup_tafsir', 'Look up tafsir',
    'Retrieve commentary from a named HadithDB tafsir source for one Quran ayah.', {
      type: 'object',
      properties: {
        tafsir: { type: 'string', minLength: 1, description: 'Alias, author, short name, or title, such as ibn-kathir.' },
        surah: { type: 'integer', minimum: 1, maximum: 114 },
        ayah: { type: 'integer', minimum: 0 },
        language: { type: 'string', enum: ['ar', 'en'], description: 'Preferred output language when available.' },
        max_chars: { type: 'integer', minimum: 1, description: 'Deprecated compatibility field. It is ignored because full commentary text is always returned.' }
      },
      required: ['tafsir', 'surah', 'ayah'],
      additionalProperties: false
    }),
  tool('search_tafsir', 'Search tafsir',
    'Search HadithDB tafsir commentary, optionally restricting results to one named source.',
    searchInputSchema({ source: true, sort: true })),
  tool('search_hadith', 'Search hadith',
    'Search Arabic or English hadith text, optionally within selected book aliases or virtual book groups.',
    searchInputSchema({ books: true })),
  tool('lookup_hadith_detail', 'Look up hadith detail',
    'Retrieve the full Arabic and English text, chain, headings, grades, scholarly metadata, and canonical URL for an exact hadith reference.', {
      type: 'object',
      properties: {
        reference: { type: 'string', minLength: 3, description: 'Reference such as bukhari:1, muslim:1907, or ahmad:1.6.' }
      },
      required: ['reference'],
      additionalProperties: false
    })
]);

function tool(name, title, description, inputSchema) {
  return Object.freeze({ name, title, description, inputSchema, annotations: READ_ONLY_ANNOTATIONS });
}

function searchInputSchema(options = {}) {
  const properties = {
    query: { type: 'string', minLength: 1, description: 'Words or phrase to search for.' },
    limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
    offset: { type: 'integer', minimum: 0, default: 0 }
  };
  if (options.books) {
    properties.books = {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 20,
      description: 'Optional HadithDB book aliases or groups such as sahihayn, sixbooks, or ninebooks.'
    };
  }
  if (options.source)
    properties.tafsir = { type: 'string', minLength: 1, description: 'Optional tafsir alias, author, short name, or title.' };
  if (options.sort)
    properties.sort = { type: 'string', enum: ['relevance', 'canonical'], default: 'relevance' };
  return { type: 'object', properties, required: ['query'], additionalProperties: false };
}

function validateToolArguments(name, args) {
  const definition = TOOLS.find(toolDefinition => toolDefinition.name === name);
  if (!definition)
    throw new Error(`Unknown tool: ${name || ''}`);
  if (!args || Array.isArray(args) || typeof args !== 'object')
    throw new Error('Tool arguments must be a JSON object.');
  const schema = definition.inputSchema;
  for (const required of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(args, required))
      throw new Error(`Missing required argument: ${required}.`);
  }
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) {
      if (schema.additionalProperties === false)
        throw new Error(`Unknown argument: ${key}.`);
      continue;
    }
    validateSchemaValue(key, value, property);
  }
  return args;
}

function validateSchemaValue(name, value, schema) {
  if (schema.type === 'string') {
    if (typeof value !== 'string')
      throw new Error(`${name} must be a string.`);
    if (schema.minLength !== undefined && value.length < schema.minLength)
      throw new Error(`${name} must contain at least ${schema.minLength} character(s).`);
    if (schema.enum && !schema.enum.includes(value))
      throw new Error(`${name} must be one of: ${schema.enum.join(', ')}.`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value))
      throw new Error(`${name} must be an integer.`);
    if (schema.minimum !== undefined && value < schema.minimum)
      throw new Error(`${name} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum)
      throw new Error(`${name} must be at most ${schema.maximum}.`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value))
      throw new Error(`${name} must be an array.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      throw new Error(`${name} must contain at most ${schema.maxItems} items.`);
    if (schema.items)
      value.forEach((item, index) => validateSchemaValue(`${name}[${index}]`, item, schema.items));
  }
}

function integer(value, name, options = {}) {
  const min = options.min === undefined ? 0 : options.min;
  const max = options.max === undefined ? Number.MAX_SAFE_INTEGER : options.max;
  if (value === undefined && options.fallback !== undefined)
    return options.fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function searchArgs(args) {
  return {
    query: requiredString(args.query, 'query'),
    limit: integer(args.limit, 'limit', { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT }),
    offset: integer(args.offset, 'offset', { min: 0, fallback: 0 })
  };
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (err) {
    throw new Error(`Invalid HadithDB base URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`HadithDB base URL must use http or https: ${value}`);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function baseUrls(req) {
  return {
    hadith: normalizeBaseUrl(process.env.HADITHDB_MCP_HADITH_BASE_URL || Utils.hadithBaseUrl(req) || Utils.DEFAULT_HADITH_BASE_URL),
    quran: normalizeBaseUrl(process.env.HADITHDB_MCP_QURAN_BASE_URL || Utils.quranBaseUrl(req) || Utils.DEFAULT_QURAN_BASE_URL)
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const response = await (options.fetch || fetch)(url, {
      headers: { Accept: 'application/json', 'User-Agent': `HadithDB-MCP/${SERVER_VERSION} (+https://hadithunlocked.com)` },
      redirect: 'follow',
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      let detail = body.slice(0, 300).replace(/\s+/g, ' ').trim();
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error || parsed.message || detail;
      } catch (err) {}
      throw new Error(`HadithDB returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    try {
      return { data: JSON.parse(body), finalUrl: response.url || String(url) };
    } catch (err) {
      throw new Error('HadithDB returned a non-JSON response.');
    }
  } catch (err) {
    if (err && err.name === 'AbortError')
      throw new Error('HadithDB request timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function htmlToText(html) {
  if (!html)
    return '';
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/section|\/li|\/h[1-6]|\/tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x?[0-9a-f]+);/gi, function (_, code) {
      return String.fromCodePoint(code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10));
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, function (_, name) {
      return { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function heading(item, level) {
  const number = item[`h${level}`];
  const english = text(item[`h${level}_title_en`] || (item.chapter && item.chapter[`h${level}_title_en`]));
  const arabic = text(item[`h${level}_title`] || (item.chapter && item.chapter[`h${level}_title`]));
  return number == null && !english && !arabic ? null : { number: number == null ? null : number, english, arabic };
}

function normalizeScriptureItem(item, baseUrl, options = {}) {
  const ref = text(item.ref) || (item.book_alias && item.num ? `${item.book_alias}:${item.num}` : null);
  const path = text(item.path) || ref;
  const result = {
    id: item.hId == null ? (item.id == null ? null : item.id) : item.hId,
    reference: ref,
    url: path ? new URL(`/${path.replace(/^\/+/, '')}`, `${baseUrl}/`).toString() : null,
    book: {
      alias: text(item.book_alias),
      name_english: text(item.book_name_en),
      name_arabic: text(item.book_name),
      short_name_english: text(item.book_shortName_en),
      short_name_arabic: text(item.book_shortName)
    },
    number: item.num == null ? null : item.num,
    chapter_number: item.numInChapter == null ? null : item.numInChapter,
    headings: [heading(item, 1), heading(item, 2), heading(item, 3)].filter(Boolean),
    english: {
      title: text(item.title_en),
      chain: text(item.chain_en),
      body: text(item.body_en),
      footnote: text(item.footnote_en)
    },
    arabic: {
      title: text(item.title),
      chain: text(item.chain),
      body: text(item.body),
      footnote: text(item.footnote)
    }
  };
  if (item.book_alias !== 'quran') {
    result.grade = {
      english: text(item.grade_grade_en),
      arabic: text(item.grade_grade),
      grader_english: text(item.grader_name_en || item.grader_shortName_en),
      grader_arabic: text(item.grader_name || item.grader_shortName)
    };
  }
  if (options.detail && item.hdithMetadata && typeof item.hdithMetadata === 'object')
    result.metadata = item.hdithMetadata;
  return result;
}

function normalizeTafsirSearchItem(item, quranBaseUrl) {
  const ref = text(item.ref) || `quran:${item.surah}:${item.ayahFrom}`;
  return {
    id: item.id == null ? null : item.id,
    source: {
      alias: text(item.commentary_alias),
      name_english: text(item.commentary_name_en),
      name_arabic: text(item.commentary_name),
      author_english: text(item.commentary_author_en),
      author_arabic: text(item.commentary_author)
    },
    reference: ref,
    surah: item.surah == null ? item.h1 : item.surah,
    ayah_from: item.ayahFrom == null ? null : item.ayahFrom,
    ayah_to: item.ayahTo == null ? null : item.ayahTo,
    text_english: text(htmlToText(item.text_en || item.translation_body_html)),
    text_arabic: text(htmlToText(item.text)),
    url: new URL(`/${(item.url || ref).replace(/^\/+/, '')}`, `${quranBaseUrl}/`).toString()
  };
}

function normalizedKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
}

async function tafsirCatalog(quranBaseUrl, options = {}) {
  const response = await fetchJson(`${quranBaseUrl}/quran/api/proxy/tafsir/books`, options);
  if (!Array.isArray(response.data))
    throw new Error('HadithDB returned an invalid tafsir catalog.');
  const byAlias = new Map();
  for (const row of response.data.filter(entry => entry && entry.type === 'tafsir' && entry.source === 'local')) {
    const alias = text(row.alias);
    if (!alias)
      continue;
    const existing = byAlias.get(alias) || {
      alias,
      name_english: null,
      name_arabic: null,
      short_name_english: null,
      short_name_arabic: null,
      author_english: null,
      author_arabic: null,
      languages: []
    };
    existing.name_english ||= text(row.name_en);
    existing.name_arabic ||= text(row.name);
    existing.short_name_english ||= text(row.shortName_en);
    existing.short_name_arabic ||= text(row.shortName);
    existing.author_english ||= text(row.author_en);
    existing.author_arabic ||= text(row.author);
    if (row.lang && !existing.languages.includes(row.lang))
      existing.languages.push(row.lang);
    byAlias.set(alias, existing);
  }
  return Array.from(byAlias.values()).sort((a, b) => a.alias.localeCompare(b.alias));
}

async function resolveTafsir(value, quranBaseUrl, options = {}) {
  const query = normalizedKey(requiredString(value, 'tafsir'));
  const catalog = await tafsirCatalog(quranBaseUrl, options);
  const fields = entry => [entry.alias, entry.name_english, entry.name_arabic, entry.short_name_english, entry.short_name_arabic, entry.author_english, entry.author_arabic];
  const exact = catalog.filter(entry => fields(entry).some(candidate => normalizedKey(candidate) === query));
  if (exact.length === 1)
    return exact[0];
  const partial = catalog.filter(entry => fields(entry).some(candidate => normalizedKey(candidate).includes(query)));
  if (partial.length === 1)
    return partial[0];
  const choices = (exact.length ? exact : partial).slice(0, 8).map(entry => entry.alias).join(', ');
  if (choices)
    throw new Error(`Tafsir '${value}' is ambiguous. Matching aliases: ${choices}.`);
  throw new Error(`Tafsir '${value}' was not found. Call list_tafsirs to discover available sources.`);
}

function result(data, summary) {
  return { structuredContent: data, content: [{ type: 'text', text: summary }] };
}

async function callTool(name, args = {}, context = {}) {
  const urls = context.baseUrls || baseUrls(context.req);
  const fetchOptions = { fetch: context.fetch };
  if (name === 'lookup_quran_ayah') {
    const surah = integer(args.surah, 'surah', { min: 1, max: 114 });
    const ayah = integer(args.ayah, 'ayah', { min: 0 });
    if (ayah === 0 && surah !== 1)
      throw new Error('Ayah 0 is valid only for Surah 1.');
    const response = await fetchJson(`${urls.quran}/quran:${surah}:${ayah}?json=1`, fetchOptions);
    if (!Array.isArray(response.data) || !response.data[0])
      throw new Error(`Quran ${surah}:${ayah} was not found.`);
    return result({ ayah: normalizeScriptureItem(response.data[0], urls.quran, { detail: true }) }, `Found Quran ${surah}:${ayah}.`);
  }
  if (name === 'search_quran') {
    const input = searchArgs(args);
    const params = new URLSearchParams({ q: input.query, b: 'quran', json: '1', o: String(input.offset) });
    if (args.sort === 'canonical')
      params.set('sort', 'canonical');
    const response = await fetchJson(`${urls.quran}/quran?${params}`, fetchOptions);
    const matches = (Array.isArray(response.data) ? response.data : []).slice(0, input.limit).map(item => normalizeScriptureItem(item, urls.quran));
    return result({ query: input.query, offset: input.offset, results: matches }, `Found ${matches.length} Quran results.`);
  }
  if (name === 'list_tafsirs') {
    const query = normalizedKey(args.query || '');
    const limit = integer(args.limit, 'limit', { min: 1, max: 100, fallback: 25 });
    const catalog = await tafsirCatalog(urls.quran, fetchOptions);
    const matches = catalog.filter(entry => !query || Object.values(entry).some(value => Array.isArray(value)
      ? value.some(item => normalizedKey(item).includes(query))
      : normalizedKey(value).includes(query))).slice(0, limit);
    return result({ query: args.query || null, tafsirs: matches }, `Found ${matches.length} tafsir sources.`);
  }
  if (name === 'lookup_tafsir') {
    const source = await resolveTafsir(args.tafsir, urls.quran, fetchOptions);
    const surah = integer(args.surah, 'surah', { min: 1, max: 114 });
    const ayah = integer(args.ayah, 'ayah', { min: 0 });
    if (ayah === 0 && surah !== 1)
      throw new Error('Ayah 0 is valid only for Surah 1.');
    const params = new URLSearchParams({ src: source.alias, s: String(surah), a: String(ayah) });
    if (args.language)
      params.set('lang', args.language);
    const response = await fetchJson(`${urls.quran}/quran/api/proxy/tafsir/local?${params}`, fetchOptions);
    const entries = Array.isArray(response.data && response.data.entries) ? response.data.entries : [response.data];
    const commentary = entries.filter(Boolean).map(entry => {
      const fullText = htmlToText(entry.html);
      return {
        id: entry.id == null ? null : entry.id,
        ayah_from: entry.ayahs_start == null ? ayah : entry.ayahs_start,
        ayah_to: (entry.ayahs_start == null ? ayah : entry.ayahs_start) + (entry.count || 0),
        bilingual: Boolean(entry.bilingual),
        language: text(entry.content_translation_language) || args.language || null,
        text: text(fullText),
        truncated: false
      };
    });
    const url = `${urls.quran}/quran/tafsir/${source.alias}/quran:${surah}:${ayah}`;
    return result({ source, reference: `quran:${surah}:${ayah}`, url, commentary }, `Found ${source.short_name_english || source.name_english || source.alias} for Quran ${surah}:${ayah}.`);
  }
  if (name === 'search_tafsir') {
    const input = searchArgs(args);
    const source = args.tafsir ? await resolveTafsir(args.tafsir, urls.quran, fetchOptions) : null;
    const collected = [];
    let pageOffset = input.offset;
    for (let page = 0; page < MAX_TAFSIR_SEARCH_PAGES && collected.length < input.limit; page++) {
      const params = new URLSearchParams({ q: input.query, b: 'commentaries', json: '1', o: String(pageOffset) });
      if (args.sort === 'canonical')
        params.set('sort', 'canonical');
      if (source)
        params.append('tafsir', source.alias);
      const response = await fetchJson(`${urls.quran}/quran?${params}`, fetchOptions);
      const batch = Array.isArray(response.data) ? response.data : [];
      collected.push(...batch.filter(item => item && item.commentary_type === 'tafsir').map(item => normalizeTafsirSearchItem(item, urls.quran)));
      if (source || batch.length < SEARCH_PAGE_SIZE)
        break;
      pageOffset += SEARCH_PAGE_SIZE;
    }
    const matches = collected.slice(0, input.limit);
    return result({ query: input.query, source, offset: input.offset, results: matches }, `Found ${matches.length} tafsir results.`);
  }
  if (name === 'search_hadith') {
    const input = searchArgs(args);
    const params = new URLSearchParams({ q: input.query, json: '1', o: String(input.offset) });
    if (args.books !== undefined) {
      if (!Array.isArray(args.books) || args.books.length > 20)
        throw new Error('books must be an array with at most 20 aliases.');
      for (const book of args.books)
        params.append('b', requiredString(book, 'book alias'));
    }
    const response = await fetchJson(`${urls.hadith}/?${params}`, fetchOptions);
    const matches = (Array.isArray(response.data) ? response.data : []).slice(0, input.limit).map(item => normalizeScriptureItem(item, urls.hadith));
    return result({ query: input.query, offset: input.offset, books: args.books || [], results: matches }, `Found ${matches.length} hadith results.`);
  }
  if (name === 'lookup_hadith_detail') {
    const reference = requiredString(args.reference, 'reference').replace(/^\/+/, '').toLowerCase();
    if (!/^[a-z0-9_-]+:[0-9]+(?:\.[0-9]+)?[a-z]?$/.test(reference))
      throw new Error('reference must look like bukhari:1, muslim:1907, or ahmad:1.6.');
    const response = await fetchJson(`${urls.hadith}/${encodeURI(reference)}?json=1`, fetchOptions);
    if (!Array.isArray(response.data) || !response.data[0])
      throw new Error(`Hadith ${reference} was not found.`);
    const records = response.data.map(item => normalizeScriptureItem(item, urls.hadith, { detail: true }));
    return result({ requested_reference: reference, canonical_url: response.finalUrl.replace(/\?json=1$/, ''), records }, `Found ${records.length} record${records.length === 1 ? '' : 's'} for ${reference}.`);
  }
  throw new Error(`Unknown tool: ${name}`);
}

module.exports = {
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS,
  baseUrls,
  callTool,
  fetchJson,
  htmlToText,
  normalizeBaseUrl,
  normalizeScriptureItem,
  resolveTafsir,
  tafsirCatalog,
  validateToolArguments
};
