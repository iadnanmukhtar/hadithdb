// @ts-check
'use strict';

const Utils = require('./Utils');
const HadithMcpSearch = require('./HadithMcpSearch');
const QuranNavigation = require('./HadithMcpQuranNavigation');
const Research = require('./HadithMcpResearch');

const SERVER_NAME = 'HadithDB';
const SERVER_VERSION = '0.9.0';
const PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const FETCH_TIMEOUT_MS = 30000;
const DEFAULT_TAFSIR_CHARS = 12000;
const COMPACT_TAFSIR_CHARS = 3500;
const DEFAULT_SHARH_CHARS = 6000;
const MAX_CONTENT_CHARS = 12000;

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
});

function nullable(type, description) {
  return { type: [type, 'null'], ...(description ? { description } : {}) };
}

function languageTextSchema() {
  return {
    type: 'object',
    description: 'The separately addressable fields for one language.',
    properties: {
      title: nullable('string'),
      chain: nullable('string'),
      body: nullable('string'),
      footnote: nullable('string')
    },
    required: ['title', 'chain', 'body', 'footnote'],
    additionalProperties: false
  };
}

function bilingualFields() {
  return {
    bilingual: { type: 'boolean', description: 'Whether both Arabic and English text are present.' },
    text: nullable('string', 'Combined English and Arabic text when either is present.'),
    text_arabic: nullable('string', 'Full Arabic text.'),
    text_english: nullable('string', 'Full English text.'),
    truncated: { type: 'boolean', description: 'Whether one or more text fields were shortened for the selected response profile.' }
  };
}

function scriptureItemSchema() {
  return {
    type: 'object',
    description: 'A normalized Quran, hadith, sirah, or history record.',
    properties: {
      id: { type: ['integer', 'string', 'null'] },
      reference: nullable('string', 'Canonical HadithDB reference.'),
      url: nullable('string', 'Canonical public URL for the record.'),
      book: {
        type: 'object',
        properties: {
          alias: nullable('string'),
          name_english: nullable('string'),
          name_arabic: nullable('string'),
          short_name_english: nullable('string'),
          short_name_arabic: nullable('string')
        },
        required: ['alias', 'name_english', 'name_arabic', 'short_name_english', 'short_name_arabic'],
        additionalProperties: false
      },
      number: { type: ['integer', 'number', 'string', 'null'] },
      chapter_number: { type: ['integer', 'number', 'string', 'null'] },
      headings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: ['integer', 'number', 'string', 'null'] },
            english: nullable('string'),
            arabic: nullable('string')
          },
          required: ['number', 'english', 'arabic'],
          additionalProperties: false
        }
      },
      english: languageTextSchema(),
      arabic: languageTextSchema(),
      ...bilingualFields(),
      grade: {
        type: 'object',
        description: 'Hadith grading and attribution. Absent for Quran records.',
        properties: {
          english: nullable('string'),
          arabic: nullable('string'),
          grader_english: nullable('string'),
          grader_arabic: nullable('string')
        },
        required: ['english', 'arabic', 'grader_english', 'grader_arabic'],
        additionalProperties: false
      },
      research_inventory: {
        type: 'object',
        description: 'Available commentary entries and verified internal report links, including in compact responses. Missing attached commentary does not imply no scholarly discussion exists.',
        properties: {
          commentary_status: { type: 'string', enum: ['found', 'searched_no_match', 'unavailable'] },
          commentary_entry_count: { type: 'integer' }, commentary_work_count: { type: 'integer' },
          commentaries: { type: 'array', items: { type: 'object', properties: { id: { type: ['integer', 'null'] }, source: Research.sourceSchema, hadith_reference: nullable('string') }, required: ['id', 'source', 'hadith_reference'], additionalProperties: false } },
          related_reports: { type: 'array', items: { type: 'object', properties: { reference: { type: 'string' }, relationship: { type: 'string' }, label: nullable('string') }, required: ['reference', 'relationship', 'label'], additionalProperties: false } },
          commentary_text_included: { type: 'boolean' }, next_step: { type: 'string' }
        },
        required: ['commentary_status', 'commentary_entry_count', 'commentary_work_count', 'commentaries', 'related_reports', 'commentary_text_included', 'next_step'], additionalProperties: false
      },
      metadata: {
        type: 'object',
        description: 'Source metadata, narrators, references, and normalized sharh when available.',
        additionalProperties: true
      },
      translation_matches: {
        type: 'array',
        description: 'Distinct translation matches merged under the canonical Quran ayah.',
        items: {
          type: 'object',
          properties: {
            source_alias: nullable('string'),
            source_name_english: nullable('string'),
            source_name_arabic: nullable('string'),
            language: nullable('string'),
            text: { type: 'string' }
          },
          required: ['source_alias', 'source_name_english', 'source_name_arabic', 'language', 'text'],
          additionalProperties: false
        }
      }
    },
    required: [
      'id', 'reference', 'url', 'book', 'number', 'chapter_number', 'headings',
      'english', 'arabic', 'bilingual', 'text', 'text_arabic', 'text_english', 'truncated'
    ],
    additionalProperties: false
  };
}

function tafsirSourceSchema() {
  return {
    type: 'object',
    description: 'A normalized local tafsir source.',
    properties: {
      alias: { type: 'string' },
      name_english: nullable('string'),
      name_arabic: nullable('string'),
      short_name_english: nullable('string'),
      short_name_arabic: nullable('string'),
      author_english: nullable('string'),
      author_arabic: nullable('string'),
      available: { type: 'boolean' },
      languages: { type: 'array', items: { type: 'string' } }
    },
    required: [
      'alias', 'name_english', 'name_arabic', 'short_name_english',
      'short_name_arabic', 'author_english', 'author_arabic', 'available', 'languages'
    ],
    additionalProperties: false
  };
}

function errorAwareOutputSchema(properties, required) {
  return {
    type: 'object',
    properties: {
      ...properties,
      error: { type: 'string', description: 'Error message when the tool could not complete the request.' }
    },
    oneOf: [
      { required },
      { required: ['error'] }
    ],
    additionalProperties: false
  };
}

function paginationSchema(maximum = MAX_LIMIT) {
  return {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum },
      returned: { type: 'integer', minimum: 0 },
      offset: { type: 'integer', minimum: 0 },
      total_available: { type: ['integer', 'null'], minimum: 0 },
      total_is_exact: { type: 'boolean' },
      has_more: { type: 'boolean' },
      next_cursor: nullable('string')
    },
    required: ['limit', 'returned', 'offset', 'total_available', 'total_is_exact', 'has_more', 'next_cursor'],
    additionalProperties: false
  };
}

function searchOutputSchema(extraProperties, itemSchema) {
  return errorAwareOutputSchema({
    query: { type: 'string' },
    offset: { type: 'integer', minimum: 0 },
    pagination: paginationSchema(),
    ...extraProperties,
    results: { type: 'array', items: itemSchema }
  }, ['query', 'offset', 'pagination', ...Object.keys(extraProperties), 'results']);
}

const SCRIPTURE_ITEM_SCHEMA = scriptureItemSchema();
const TAFSIR_SOURCE_SCHEMA = tafsirSourceSchema();
const TAFSIR_COMMENTARY_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: ['integer', 'string', 'null'] },
    ayah_from: { type: ['integer', 'number', 'string'] },
    ayah_to: { type: ['integer', 'number', 'string'] },
    language: nullable('string'),
    ...bilingualFields()
  },
  required: ['id', 'ayah_from', 'ayah_to', 'language', 'bilingual', 'text', 'text_arabic', 'text_english', 'truncated'],
  additionalProperties: false
};
const TAFSIR_SEARCH_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: ['integer', 'string', 'null'] },
    source: {
      type: 'object',
      properties: {
        alias: nullable('string'),
        name_english: nullable('string'),
        name_arabic: nullable('string'),
        author_english: nullable('string'),
        author_arabic: nullable('string'),
        languages: { type: 'array', items: { type: 'string' } }
      },
      required: ['alias', 'name_english', 'name_arabic', 'author_english', 'author_arabic', 'languages'],
      additionalProperties: false
    },
    reference: { type: 'string' },
    surah: { type: ['integer', 'number', 'string', 'null'] },
    ayah_from: { type: ['integer', 'number', 'string', 'null'] },
    ayah_to: { type: ['integer', 'number', 'string', 'null'] },
    ...bilingualFields(),
    url: { type: 'string' }
  },
  required: [
    'id', 'source', 'reference', 'surah', 'ayah_from', 'ayah_to', 'bilingual',
    'text', 'text_arabic', 'text_english', 'truncated', 'url'
  ],
  additionalProperties: false
};

const RECITER_SCHEMA = {
  type: 'object',
  properties: { alias: { type: 'string' }, name: { type: 'string' } },
  required: ['alias', 'name'],
  additionalProperties: false
};

const OUTPUT_SCHEMAS = Object.freeze({
  ...Object.fromEntries(Research.DEFINITIONS.map(definition => [definition.name, errorAwareOutputSchema(definition.outputProperties, Object.keys(definition.outputProperties))])),
  ...Object.fromEntries(QuranNavigation.DEFINITIONS.map(definition => [definition.name,
    errorAwareOutputSchema(definition.outputProperties, Object.keys(definition.outputProperties))])),
  list_quran_reciters: errorAwareOutputSchema({
    default_reciter: { type: 'string' },
    reciters: { type: 'array', items: RECITER_SCHEMA }
  }, ['default_reciter', 'reciters']),
  get_quran_audio: errorAwareOutputSchema({
    reciter: RECITER_SCHEMA,
    reference: { type: 'string' },
    audio_url: { type: 'string', description: 'Full surah audio file; use the supplied timing boundaries for the requested passage.' },
    playback_url: { type: 'string', description: 'Audio URL with a temporal media fragment in seconds. Client support varies.' },
    start_ms: { type: 'integer', minimum: 0 },
    end_ms: { type: 'integer', minimum: 1 },
    segments: {
      type: 'array', minItems: 1,
      items: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          start_ms: { type: 'integer', minimum: 0 },
          end_ms: { type: 'integer', minimum: 1 }
        },
        required: ['reference', 'start_ms', 'end_ms'], additionalProperties: false
      }
    }
  }, ['reciter', 'reference', 'audio_url', 'playback_url', 'start_ms', 'end_ms', 'segments']),
  lookup_quran_ayah: errorAwareOutputSchema({ ayah: SCRIPTURE_ITEM_SCHEMA }, ['ayah']),
  search_quran: searchOutputSchema({}, SCRIPTURE_ITEM_SCHEMA),
  list_tafsirs: errorAwareOutputSchema({
    query: nullable('string'),
    total: { type: 'integer', minimum: 0 },
    has_more: { type: 'boolean' },
    next_cursor: nullable('string'),
    tafsirs: { type: 'array', items: TAFSIR_SOURCE_SCHEMA }
  }, ['query', 'total', 'has_more', 'next_cursor', 'tafsirs']),
  lookup_tafsir: errorAwareOutputSchema({
    source: TAFSIR_SOURCE_SCHEMA,
    reference: { type: 'string' },
    url: { type: 'string' },
    response_profile: { type: 'string', enum: ['compact', 'default', 'full'] },
    availability: {
      type: 'object',
      properties: {
        requested_language: nullable('string'),
        resolved_language: nullable('string'),
        fallback_used: { type: 'boolean' },
        available_languages: { type: 'array', items: { type: 'string' } },
        has_arabic: { type: 'boolean' },
        has_english: { type: 'boolean' }
      },
      required: ['requested_language', 'resolved_language', 'fallback_used', 'available_languages', 'has_arabic', 'has_english'],
      additionalProperties: false
    },
    commentary: { type: 'array', items: TAFSIR_COMMENTARY_SCHEMA }
  }, ['source', 'reference', 'url', 'response_profile', 'availability', 'commentary']),
  search_tafsir: searchOutputSchema({
    source: { anyOf: [TAFSIR_SOURCE_SCHEMA, { type: 'null' }] }
  }, TAFSIR_SEARCH_ITEM_SCHEMA),
  search_hadith: searchOutputSchema({
    books: { type: 'array', items: { type: 'string' } }
  }, SCRIPTURE_ITEM_SCHEMA),
  lookup_hadith_detail: errorAwareOutputSchema({
    requested_reference: { type: 'string' },
    canonical_url: { type: 'string' },
    response_profile: { type: 'string', enum: ['compact', 'default', 'full'] },
    records: { type: 'array', minItems: 1, items: SCRIPTURE_ITEM_SCHEMA }
  }, ['requested_reference', 'canonical_url', 'response_profile', 'records'])
});

const TOOLS = Object.freeze([
  ...Research.DEFINITIONS.map(definition => tool(definition.name, definition.title, definition.description, definition.inputSchema)),
  ...QuranNavigation.DEFINITIONS.map(definition => tool(definition.name, definition.title, definition.description, definition.inputSchema)),
  tool('list_quran_reciters', 'List Quran reciters',
    'List available Quran audio reciters and their aliases. Use this to resolve a requested reciter. Juhani is the default.', {
      type: 'object', properties: {}, additionalProperties: false
    }),
  tool('get_quran_audio', 'Get Quran passage audio',
    'Get an audio URL and exact ayah timing segments for a Quran passage by a selected reciter (default: Juhani). Returns playback data, not a command that starts playback. Use surah, ayah_from, and optionally ayah_to for an inclusive range. For portions spanning surahs, call once per surah and play in order. Use list_quran_reciters for available names and aliases. Clients must seek to start_ms and stop at end_ms; the URL points to the full surah.', {
      type: 'object',
      properties: {
        surah: { type: 'integer', minimum: 1, maximum: 114 },
        ayah_from: { type: 'integer', minimum: 1, maximum: 286 },
        ayah_to: { type: 'integer', minimum: 1, maximum: 286, description: 'Inclusive last ayah; defaults to ayah_from. For a whole surah, specify its first and last ayah.' },
        reciter: { type: 'string', minLength: 1, default: 'juhani', description: 'Reciter alias or exact catalog name. Defaults to Juhani.' }
      },
      required: ['surah', 'ayah_from'], additionalProperties: false
    }),
  tool('lookup_quran_ayah', 'Look up Quran ayah',
    'Retrieve the exact Arabic text, English translation, headings, and canonical URL for one Quran ayah. For explanations of its meaning, use research_quran_ayah to consult major available tafsirs and research its concepts in hadith and shuruh before synthesizing.', {
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
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        cursor: { type: 'string', minLength: 1, description: 'Opaque cursor returned by the previous page. Do not modify it.' }
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
        response_profile: { type: 'string', enum: ['compact', 'default', 'full'], default: 'default', description: 'Controls response size. Compact shortens long commentary, default balances context and size, and full returns all stored text.' },
        max_chars: { type: 'integer', minimum: 1, maximum: 100000, description: 'Optional explicit character cap per language, overriding the selected response profile.' }
      },
      required: ['tafsir', 'surah', 'ayah'],
      additionalProperties: false
    }),
  tool('search_tafsir', 'Search tafsir',
    'Search HadithDB tafsir commentary, optionally restricting results to one named source.',
    searchInputSchema({ source: true, sort: true })),
  tool('search_hadith', 'Search hadith',
    'Search Arabic or English hadith, sirah, and history text, optionally within selected book aliases or virtual book groups. Use the sirah or history scope to search every book whose type is sirah or history.',
    searchInputSchema({ books: true })),
  tool('lookup_hadith_detail', 'Look up hadith detail',
    'Retrieve the core Arabic and English text, chain, headings, grades, and canonical URL for an exact hadith reference. Complete scholarly metadata and provenance are available with response_profile: "full". Compact includes an inventory of available commentary and verified related reports. For worship instructions or scholarly explanations, use research_islamic_topic and the commentary tools before answering.', {
      type: 'object',
      properties: {
        reference: { type: 'string', minLength: 3, description: 'Reference such as bukhari:1, muslim:1907, or ahmad:1.6.' },
        response_profile: { type: 'string', enum: ['compact', 'default', 'full'], default: 'compact', description: 'Compact returns the core record and is the default. Default adds bounded attribution, narrator, grading, reference, and commentary metadata. Full explicitly returns all stored provenance and metadata.' }
      },
      required: ['reference'],
      additionalProperties: false
    })
]);

function tool(name, title, description, inputSchema) {
  return Object.freeze({
    name,
    title,
    description,
    inputSchema,
    outputSchema: OUTPUT_SCHEMAS[name],
    annotations: READ_ONLY_ANNOTATIONS
  });
}

function searchInputSchema(options = {}) {
  const properties = {
    query: { type: 'string', minLength: 1, description: 'Words or phrase to search for.' },
    limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
    cursor: { type: 'string', minLength: 1, description: 'Opaque cursor returned by the previous page. Do not modify it.' },
    offset: { type: 'integer', minimum: 0, default: 0, description: 'Deprecated numeric pagination offset. Prefer cursor.' }
  };
  if (options.books) {
    properties.books = {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 20,
      description: 'Optional HadithDB book aliases or groups such as sahihayn, sixbooks, ninebooks, sirah, or history. Either sirah or history searches all books of both historical types.'
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
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      throw new Error(`${name} must contain at most ${schema.maxLength} characters.`);
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
    if (schema.minItems !== undefined && value.length < schema.minItems)
      throw new Error(`${name} must contain at least ${schema.minItems} items.`);
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
    cursor: args.cursor,
    offset: integer(args.offset, 'offset', { min: 0, fallback: 0 })
  };
}

function responseProfile(args, fallback = 'default') {
  return args.response_profile || fallback;
}

function profileCharacterLimit(args) {
  if (args.max_chars !== undefined)
    return integer(args.max_chars, 'max_chars', { min: 1, max: 100000 });
  if (responseProfile(args) === 'compact')
    return COMPACT_TAFSIR_CHARS;
  if (responseProfile(args) === 'full')
    return Number.POSITIVE_INFINITY;
  return DEFAULT_TAFSIR_CHARS;
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
    const requestedOrigin = new URL(String(url)).origin;
    const responseOrigin = new URL(response.url || String(url)).origin;
    if (responseOrigin !== requestedOrigin)
      throw new Error('HadithDB refused a cross-origin data redirect.');
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

function combinedLanguageText(language) {
  return ['title', 'chain', 'body', 'footnote']
    .map(key => text(language && language[key]))
    .filter(Boolean)
    .join('\n\n') || null;
}

function truncateText(value, maxChars) {
  value = text(value);
  if (!value || !Number.isFinite(maxChars) || value.length <= maxChars)
    return { value, truncated: false };
  const shortened = value.slice(0, Math.max(1, maxChars - 1)).trimEnd();
  return { value: `${shortened}…`, truncated: true };
}

function bilingualTextFields(arabicText, englishText, maxChars = Number.POSITIVE_INFINITY) {
  const arabic = truncateText(arabicText, maxChars);
  const english = truncateText(englishText, maxChars);
  arabicText = arabic.value;
  englishText = english.value;
  return {
    bilingual: Boolean(arabicText && englishText),
    text: [englishText, arabicText].filter(Boolean).join('\n\n') || null,
    text_arabic: arabicText,
    text_english: englishText,
    truncated: arabic.truncated || english.truncated
  };
}

function cleanSearchField(value) {
  return text(htmlToText(value));
}

function cleanSearchScriptureItem(item) {
  return {
    ...item,
    title_en: cleanSearchField(item.title_en),
    chain_en: cleanSearchField(item.chain_en),
    body_en: cleanSearchField(item.body_en),
    footnote_en: cleanSearchField(item.footnote_en),
    title: cleanSearchField(item.title),
    chain: cleanSearchField(item.chain),
    body: cleanSearchField(item.body),
    footnote: cleanSearchField(item.footnote)
  };
}

function canonicalQuranReference(item) {
  const ref = text(item && item.ref);
  const refMatch = ref && ref.match(/^quran:(\d+):(\d+)/);
  if (refMatch)
    return `quran:${Number(refMatch[1])}:${Number(refMatch[2])}`;
  const surah = Number(item && (item.surah == null ? item.h1 : item.surah));
  const ayah = Number(item && (item.ayahFrom == null ? item.numInChapter : item.ayahFrom));
  return Number.isInteger(surah) && Number.isInteger(ayah) ? `quran:${surah}:${ayah}` : null;
}

function translationMatch(item) {
  if (!item || item.commentary_type !== 'trans')
    return null;
  const translationText = cleanSearchField(item.translation_body_html || item.text_en || item.text);
  if (!translationText)
    return null;
  return {
    source_alias: text(item.commentary_alias),
    source_name_english: text(item.commentary_name_en),
    source_name_arabic: text(item.commentary_name),
    language: text(item.content_translation_language || item.commentary_lang || 'en'),
    text: translationText
  };
}

function normalizeQuranSearchItem(item, quranBaseUrl) {
  const reference = canonicalQuranReference(item);
  if (!reference)
    return null;
  const match = translationMatch(item);
  const adapted = cleanSearchScriptureItem({
    ...item,
    ref: reference,
    path: reference,
    book_alias: 'quran',
    body_en: match ? match.text : item.body_en,
    body: item.commentary_type === 'trans' ? null : item.body
  });
  return {
    ...normalizeScriptureItem(adapted, quranBaseUrl),
    translation_matches: match ? [match] : [],
    _quran_base_present: !match
  };
}

function mergeLanguageRecord(primary, secondary) {
  return {
    title: primary.title || secondary.title,
    chain: primary.chain || secondary.chain,
    body: primary.body || secondary.body,
    footnote: primary.footnote || secondary.footnote
  };
}

function mergeQuranSearchItems(primary, secondary) {
  const english = mergeLanguageRecord(primary.english, secondary.english);
  const arabic = mergeLanguageRecord(primary.arabic, secondary.arabic);
  const translations = [];
  const seen = new Set();
  for (const match of [...(primary.translation_matches || []), ...(secondary.translation_matches || [])]) {
    const key = `${match.source_alias || ''}\u0000${match.language || ''}\u0000${match.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      translations.push(match);
    }
  }
  return {
    ...primary,
    id: primary.id == null ? secondary.id : primary.id,
    book: primary.book.alias ? primary.book : secondary.book,
    number: primary.number == null ? secondary.number : primary.number,
    chapter_number: primary.chapter_number == null ? secondary.chapter_number : primary.chapter_number,
    headings: primary.headings.length ? primary.headings : secondary.headings,
    english,
    arabic,
    ...bilingualTextFields(combinedLanguageText(arabic), combinedLanguageText(english)),
    translation_matches: translations,
    _quran_base_present: Boolean(primary._quran_base_present || secondary._quran_base_present)
  };
}

async function hydrateQuranSearchItem(item, quranBaseUrl, options = {}) {
  if (!item)
    return item;
  const { _quran_base_present: basePresent, ...publicItem } = item;
  if (!item.reference || basePresent || !(item.translation_matches || []).length)
    return publicItem;
  const match = item.reference.match(/^quran:(\d+):(\d+)$/);
  if (!match)
    return publicItem;
  const response = await fetchJson(`${quranBaseUrl}/${encodeURI(item.reference)}?json=1`, options);
  if (!Array.isArray(response.data) || !response.data[0])
    throw new Error(`Quran ${match[1]}:${match[2]} was not found while hydrating a translation search result.`);
  const canonical = normalizeScriptureItem(response.data[0], quranBaseUrl, { detail: true });
  const hydrated = mergeQuranSearchItems({ ...canonical, translation_matches: [], _quran_base_present: true }, publicItem);
  const result = { ...hydrated };
  delete result._quran_base_present;
  return result;
}

function normalizeHadithSearchItem(item, hadithBaseUrl) {
  return normalizeScriptureItem(cleanSearchScriptureItem(item), hadithBaseUrl);
}

function normalizeSharhEntry(entry) {
  const arabicText = text(entry && entry.text);
  const englishText = text(entry && entry.text_en);
  const bilingual = bilingualTextFields(arabicText, englishText);
  return {
    ...entry,
    title_arabic: text(entry && entry.title),
    title_english: text(entry && entry.title_en),
    bilingual: bilingual.bilingual,
    text_arabic: bilingual.text_arabic,
    text_english: bilingual.text_english,
    text_combined: bilingual.text,
    truncated: false
  };
}

function normalizeDefaultSharhEntry(entry) {
  entry = entry && typeof entry === 'object' ? entry : {};
  const arabic = truncateText(entry.text, DEFAULT_SHARH_CHARS);
  const english = truncateText(entry.text_en, DEFAULT_SHARH_CHARS);
  return {
    id: entry.id == null ? null : entry.id,
    source_id: entry.source_id == null ? null : entry.source_id,
    source_title: text(entry.source_title),
    title_arabic: text(entry.title || entry.source_title),
    title_english: text(entry.title_en),
    author_arabic: text(entry.author),
    author_english: text(entry.author_en),
    source_url: text(entry.source_url),
    bilingual: Boolean(arabic.value && english.value),
    text_arabic: arabic.value,
    text_english: english.value,
    truncated: arabic.truncated || english.truncated
  };
}

function limitedArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function normalizeDefaultDetailMetadata(metadata) {
  const sharh = limitedArray(metadata.sharh, 5).map(normalizeDefaultSharhEntry);
  const truncated = (Array.isArray(metadata.sharh) && metadata.sharh.length > sharh.length) ||
    (Array.isArray(metadata.narrators) && metadata.narrators.length > 20) ||
    (Array.isArray(metadata.takhrij) && metadata.takhrij.length > 20) ||
    (Array.isArray(metadata.shawahid) && metadata.shawahid.length > 20) ||
    sharh.some(entry => entry.truncated);
  return {
    sourceBookSlug: text(metadata.sourceBookSlug),
    sourceEntryId: metadata.sourceEntryId == null ? null : metadata.sourceEntryId,
    sourceReference: text(metadata.sourceReference),
    sourceUrl: text(metadata.sourceUrl),
    attribution: metadata.attribution || null,
    sourceAttribution: text(metadata.sourceAttribution),
    chainCategories: limitedArray(metadata.chainCategories, 10),
    narrator: text(metadata.narrator),
    narratorEn: text(metadata.narratorEn),
    sourceIsnadHtml: truncateText(metadata.sourceIsnadHtml, DEFAULT_SHARH_CHARS).value,
    narrators: limitedArray(metadata.narrators, 20),
    takhrij: limitedArray(metadata.takhrij, 20),
    shawahid: limitedArray(metadata.shawahid, 20),
    sharh,
    grades: limitedArray(metadata.grades, 10),
    truncated
  };
}

function normalizeDetailMetadata(metadata, profile) {
  if (profile === 'default')
    return normalizeDefaultDetailMetadata(metadata);
  return {
    ...metadata,
    ...(Array.isArray(metadata.sharh) ? { sharh: metadata.sharh.map(normalizeSharhEntry) } : {})
  };
}

function normalizeScriptureItem(item, baseUrl, options = {}) {
  const ref = text(item.ref) || (item.book_alias && item.num ? `${item.book_alias}:${item.num}` : null);
  // Quran SQL paths can contain decimal section numbers (quran/1.00/1.00),
  // which are not reader routes. The exact ayah reference is the stable URL.
  const path = /^quran:\d+:\d+$/.test(ref || '') ? ref : (text(item.path) || ref);
  const english = {
    title: text(item.title_en),
    chain: text(item.chain_en),
    body: text(item.body_en),
    footnote: text(item.footnote_en)
  };
  const arabic = {
    title: text(item.title),
    chain: text(item.chain),
    body: text(item.body),
    footnote: text(item.footnote)
  };
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
    english,
    arabic,
    ...bilingualTextFields(combinedLanguageText(arabic), combinedLanguageText(english))
  };
  if (item.book_alias !== 'quran') {
    result.grade = {
      english: text(item.grade_grade_en),
      arabic: text(item.grade_grade),
      grader_english: text(item.grader_name_en || item.grader_shortName_en),
      grader_arabic: text(item.grader_name || item.grader_shortName)
    };
  }
  if (item.book_alias !== 'quran' && (options.detail || options.inventory)) {
    result.research_inventory = Research.inventory(item.hdithMetadata, ref);
    result.research_inventory.commentary_text_included = !!(options.detail && item.hdithMetadata?.sharh?.length);
  }
  if (options.detail && item.hdithMetadata && typeof item.hdithMetadata === 'object')
    result.metadata = normalizeDetailMetadata(item.hdithMetadata, options.profile || 'full');
  return result;
}

function normalizeTafsirSearchItem(item, quranBaseUrl) {
  const ref = text(item.ref) || `quran:${item.surah}:${item.ayahFrom}`;
  const englishText = text(htmlToText(item.text_en || item.translation_body_html));
  const arabicText = text(htmlToText(item.text));
  return {
    id: item.id == null ? null : item.id,
    source: {
      alias: text(item.commentary_alias),
      name_english: text(item.commentary_name_en),
      name_arabic: text(item.commentary_name),
      author_english: text(item.commentary_author_en),
      author_arabic: text(item.commentary_author),
      languages: Array.from(new Set([text(item.content_translation_language || item.commentary_lang)].filter(Boolean)))
    },
    reference: ref,
    surah: item.surah == null ? item.h1 : item.surah,
    ayah_from: item.ayahFrom == null ? null : item.ayahFrom,
    ayah_to: item.ayahTo == null ? null : item.ayahTo,
    ...bilingualTextFields(arabicText, englishText),
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
      available: true,
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

function normalizeTafsirCommentaryEntry(entry, ayah, language, maxChars) {
  const fullText = htmlToText(entry.html);
  let arabicText = htmlToText(entry.arabic_html);
  let englishText = htmlToText(entry.translation_html);
  if (!arabicText && !englishText && fullText) {
    if (language === 'ar')
      arabicText = fullText;
    else
      englishText = fullText;
  }
  const bilingual = bilingualTextFields(arabicText, englishText, maxChars);
  return {
    id: entry.id == null ? null : entry.id,
    ayah_from: entry.ayahs_start == null ? ayah : entry.ayahs_start,
    ayah_to: (entry.ayahs_start == null ? ayah : entry.ayahs_start) + (entry.count || 0),
    language: language || text(entry.content_translation_language) || null,
    ...bilingual
  };
}

function tafsirResponseEntries(data) {
  const entries = Array.isArray(data && data.entries) ? data.entries : [data];
  return entries.filter(entry => entry && typeof entry === 'object');
}

async function fetchTafsirCommentary(source, surah, ayah, requestedLanguage, maxChars, quranBaseUrl, options) {
  const candidates = Array.from(new Set([
    requestedLanguage,
    ...(source.languages || []),
    requestedLanguage === 'en' ? 'ar' : 'en'
  ].filter(Boolean)));
  if (!candidates.length)
    candidates.push(null);
  let commentary = [];
  let resolvedLanguage = null;
  let lastError = null;
  let receivedResponse = false;
  for (const language of candidates) {
    const params = new URLSearchParams({ src: source.alias, s: String(surah), a: String(ayah) });
    if (language)
      params.set('lang', language);
    let response;
    try {
      response = await fetchJson(`${quranBaseUrl}/quran/api/proxy/tafsir/local?${params}`, options);
      receivedResponse = true;
    } catch (err) {
      lastError = err;
      continue;
    }
    commentary = tafsirResponseEntries(response.data)
      .map(entry => normalizeTafsirCommentaryEntry(entry, ayah, language, maxChars))
      .filter(entry => entry.text_arabic || entry.text_english);
    if (commentary.length) {
      const hasRequested = requestedLanguage === 'ar'
        ? commentary.some(entry => entry.text_arabic)
        : requestedLanguage === 'en'
          ? commentary.some(entry => entry.text_english)
          : false;
      resolvedLanguage = hasRequested
        ? requestedLanguage
        : (commentary.some(entry => entry.text_english) ? 'en' : commentary.some(entry => entry.text_arabic) ? 'ar' : language);
      break;
    }
  }
  if (!receivedResponse && lastError)
    throw lastError;
  const hasArabic = commentary.some(entry => entry.text_arabic);
  const hasEnglish = commentary.some(entry => entry.text_english);
  return {
    commentary,
    availability: {
      requested_language: requestedLanguage || null,
      resolved_language: resolvedLanguage,
      fallback_used: Boolean(requestedLanguage && resolvedLanguage && requestedLanguage !== resolvedLanguage),
      available_languages: Array.from(new Set(source.languages || [])).sort(),
      has_arabic: hasArabic,
      has_english: hasEnglish
    }
  };
}

function boundedContent(value, maxChars = MAX_CONTENT_CHARS) {
  value = String(value || '').trim();
  if (value.length <= maxChars)
    return value;
  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function scriptureRendition(item, perLanguageChars = 3500) {
  const lines = [item.reference, item.url].filter(Boolean);
  const english = truncateText(item.text_english, perLanguageChars).value;
  const arabic = truncateText(item.text_arabic, perLanguageChars).value;
  if (english)
    lines.push(`English:\n${english}`);
  if (arabic)
    lines.push(`Arabic:\n${arabic}`);
  if (item.research_inventory) {
    const inventory = item.research_inventory;
    lines.push(`Commentary: ${inventory.commentary_entry_count} entries across ${inventory.commentary_work_count} works (${inventory.commentary_status}).`);
    lines.push(...inventory.commentaries.map(entry => `${entry.id}: ${entry.source.title_english || entry.source.title_arabic || entry.source.alias || 'Unnamed commentary'}`));
    lines.push(inventory.next_step);
  }
  if (item.grade) {
    const grade = [item.grade.english, item.grade.grader_english].filter(Boolean).join(' — ') ||
      [item.grade.arabic, item.grade.grader_arabic].filter(Boolean).join(' — ');
    if (grade)
      lines.push(`Grade: ${grade}`);
  }
  return lines.join('\n\n');
}

function resultContent(data, summary) {
  const parts = [summary];
  if (data.ayah)
    parts.push(scriptureRendition(data.ayah));
  else if (Array.isArray(data.records))
    parts.push(...data.records.map(record => scriptureRendition(record)));
  else if (Array.isArray(data.commentary)) {
    parts.push([data.source && (data.source.short_name_english || data.source.name_english || data.source.alias), data.reference, data.url].filter(Boolean).join('\n'));
    for (const entry of data.commentary) {
      const english = truncateText(entry.text_english, 4000).value;
      const arabic = truncateText(entry.text_arabic, 4000).value;
      parts.push([english && `English:\n${english}`, arabic && `Arabic:\n${arabic}`].filter(Boolean).join('\n\n'));
    }
  } else if (Array.isArray(data.tafsirs)) {
    parts.push(...data.tafsirs.map(source => `${source.alias} — ${source.name_english || source.name_arabic || source.alias} [${source.languages.join(', ')}]`));
    parts.push(`Total: ${data.total}. More: ${data.has_more ? 'yes' : 'no'}.`);
  } else if (Array.isArray(data.results)) {
    parts.push(...data.results.map(item => item.reference
      ? scriptureRendition(item, 800)
      : [item.source && (item.source.name_english || item.source.alias), item.url, truncateText(item.text_english || item.text_arabic, 800).value].filter(Boolean).join('\n')));
    if (data.pagination)
      parts.push(`Returned ${data.pagination.returned}; more: ${data.pagination.has_more ? 'yes' : 'no'}.`);
  }
  return boundedContent(parts.filter(Boolean).join('\n\n'));
}

function result(data, summary) {
  return { structuredContent: data, content: [{ type: 'text', text: resultContent(data, summary) }] };
}

async function audioReciters(urls, fetchOptions) {
  const response = await fetchJson(`${urls.quran}/quran/api/proxy/quran-audio/recitations`, fetchOptions);
  if (!Array.isArray(response.data.recitations))
    throw new Error('HadithDB returned an invalid reciter catalog.');
  return response.data.recitations.map(item => ({
    alias: String(item.id || item.slug),
    name: String(item.reciter_name || item.label || item.shortName || item.id),
    names: [item.id, item.slug, item.reciter_name, item.label, item.shortName].filter(Boolean).map(value => String(value).trim().toLowerCase())
  }));
}

async function quranAudio(args, urls, fetchOptions) {
  const surah = integer(args.surah, 'surah', { min: 1, max: 114 });
  const from = integer(args.ayah_from, 'ayah_from', { min: 1, max: 286 });
  const to = integer(args.ayah_to, 'ayah_to', { min: from, max: 286, fallback: from });
  const requested = requiredString(args.reciter === undefined ? 'juhani' : args.reciter, 'reciter').toLowerCase();
  const catalog = await audioReciters(urls, fetchOptions);
  const matches = catalog.filter(item => item.names.includes(requested));
  const reciter = catalog.find(item => item.alias.toLowerCase() === requested) || (matches.length === 1 ? matches[0] : null);
  if (!reciter)
    throw new Error('Unknown or ambiguous Quran reciter. Use list_quran_reciters for available aliases.');
  const params = new URLSearchParams({ s: String(surah), from: String(from), to: String(to), reciter: reciter.alias });
  const response = await fetchJson(`${urls.quran}/quran/api/proxy/quran-audio/passage?${params}`, fetchOptions);
  const audio = response.data.audio;
  if (!Array.isArray(audio) || !audio.length)
    throw new Error('No Quran audio is available for this passage.');
  const segments = [];
  const audioUrl = new URL(audio[0].url);
  if (!['https:', 'http:'].includes(audioUrl.protocol))
    throw new Error('Invalid Quran audio URL.');
  for (let ayah = from; ayah <= to; ayah++) {
    const matches = audio.filter(item => Number(item.ayah) === ayah && item.verseKey === `${surah}:${ayah}`);
    if (matches.length !== 1)
      throw new Error(`Quran audio is missing or ambiguous for ${surah}:${ayah}.`);
    const item = matches[0];
    if (item.url !== audio[0].url || !Number.isInteger(item.startMs) || !Number.isInteger(item.endMs) ||
        item.startMs < 0 || item.endMs <= item.startMs ||
        (segments.length && item.startMs < segments[segments.length - 1].start_ms))
      throw new Error(`Invalid Quran audio timing or track for ${surah}:${ayah}.`);
    segments.push({ reference: `quran:${surah}:${ayah}`, start_ms: item.startMs, end_ms: item.endMs });
  }
  const start = segments[0].start_ms;
  const end = segments[segments.length - 1].end_ms;
  audioUrl.hash = `t=${start / 1000},${end / 1000}`;
  const data = {
    reciter: { alias: reciter.alias, name: reciter.name },
    reference: `quran:${surah}:${from}${to === from ? '' : `-${to}`}`,
    audio_url: audio[0].url, playback_url: audioUrl.toString(),
    start_ms: start, end_ms: end, segments
  };
  // Preserve every timing in text-only MCP clients as well as structured clients.
  return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
}

async function callTool(name, args = {}, context = {}) {
  const urls = context.baseUrls || baseUrls(context.req);
  const fetchOptions = { fetch: context.fetch };
  const researchTool = Research.DEFINITIONS.find(definition => definition.name === name);
  if (researchTool) {
    validateToolArguments(name, args);
    const researchContext = { ...context, baseUrls: urls };
    const data = name.startsWith('research_')
      ? await Research.research(name, args, researchContext, callTool)
      : await Research.commentaryTool(name, args, researchContext);
    return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
  }
  const navigation = QuranNavigation.DEFINITIONS.find(definition => definition.name === name);
  if (navigation) {
    validateToolArguments(name, args);
    const data = await navigation.handler(args, urls.quran);
    return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
  }
  if (name === 'list_quran_reciters') {
    const reciters = (await audioReciters(urls, fetchOptions)).map(({ alias, name }) => ({ alias, name }));
    return result({ default_reciter: 'juhani', reciters }, `Available Quran reciters (default: juhani):\n${reciters.map(item => `${item.alias} — ${item.name}`).join('\n')}`);
  }
  if (name === 'get_quran_audio')
    return quranAudio(args, urls, fetchOptions);
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
    const page = await HadithMcpSearch.searchPage({
      scope: 'quran',
      query: input.query,
      filters: ['quran', 'translations'],
      searchOptions: { sort: args.sort === 'canonical' ? 'canonical' : 'relevance' },
      limit: input.limit,
      cursor: input.cursor,
      offset: input.offset,
      mapItem: item => normalizeQuranSearchItem(item, urls.quran),
      key: item => item.reference,
      merge: mergeQuranSearchItems
    }, { search: context.search, deadlineMs: context.deadlineMs });
    const results = await Promise.all(page.results.map(item => hydrateQuranSearchItem(item, urls.quran, fetchOptions)));
    return result({ query: input.query, offset: page.pagination.offset, pagination: page.pagination, results }, `Found ${results.length} Quran results.`);
  }
  if (name === 'list_tafsirs') {
    const query = normalizedKey(args.query || '');
    const limit = integer(args.limit, 'limit', { min: 1, max: 100, fallback: 25 });
    const catalog = await tafsirCatalog(urls.quran, fetchOptions);
    const matches = catalog.filter(entry => !query || Object.values(entry).some(value => Array.isArray(value)
      ? value.some(item => normalizedKey(item).includes(query))
      : normalizedKey(value).includes(query)));
    const fingerprint = HadithMcpSearch.searchFingerprint({ scope: 'tafsir-catalog', query });
    const offset = args.cursor === undefined ? 0 : HadithMcpSearch.decodeCursor(args.cursor, fingerprint);
    if (offset > matches.length)
      throw new Error('Tafsir catalog cursor is past the available results.');
    const tafsirs = matches.slice(offset, offset + limit);
    const nextOffset = offset + tafsirs.length;
    const hasMore = nextOffset < matches.length;
    return result({
      query: args.query || null,
      total: matches.length,
      has_more: hasMore,
      next_cursor: hasMore ? HadithMcpSearch.encodeCursor(nextOffset, fingerprint) : null,
      tafsirs
    }, `Found ${tafsirs.length} of ${matches.length} tafsir sources.`);
  }
  if (name === 'lookup_tafsir') {
    const source = await resolveTafsir(args.tafsir, urls.quran, fetchOptions);
    const surah = integer(args.surah, 'surah', { min: 1, max: 114 });
    const ayah = integer(args.ayah, 'ayah', { min: 0 });
    if (ayah === 0 && surah !== 1)
      throw new Error('Ayah 0 is valid only for Surah 1.');
    const profile = responseProfile(args);
    const fetched = await fetchTafsirCommentary(source, surah, ayah, args.language, profileCharacterLimit(args), urls.quran, fetchOptions);
    const url = `${urls.quran}/quran/tafsir/${source.alias}/quran:${surah}:${ayah}`;
    return result({
      source,
      reference: `quran:${surah}:${ayah}`,
      url,
      response_profile: profile,
      availability: fetched.availability,
      commentary: fetched.commentary
    }, `Found ${source.short_name_english || source.name_english || source.alias} for Quran ${surah}:${ayah}.`);
  }
  if (name === 'search_tafsir') {
    const input = searchArgs(args);
    const source = args.tafsir ? await resolveTafsir(args.tafsir, urls.quran, fetchOptions) : null;
    const page = await HadithMcpSearch.searchPage({
      scope: 'tafsir',
      query: input.query,
      filters: ['commentaries'],
      searchOptions: {
        sort: args.sort === 'canonical' ? 'canonical' : 'relevance',
        tafsirAliases: source ? [source.alias] : []
      },
      limit: input.limit,
      cursor: input.cursor,
      offset: input.offset,
      mapItem: item => item && item.commentary_type === 'tafsir' ? normalizeTafsirSearchItem(item, urls.quran) : null,
      key: item => `${item.source.alias || ''}:${item.reference}:${item.id == null ? '' : item.id}`
    }, { search: context.search, deadlineMs: context.deadlineMs });
    return result({ query: input.query, source, offset: page.pagination.offset, pagination: page.pagination, results: page.results }, `Found ${page.results.length} tafsir results.`);
  }
  if (name === 'search_hadith') {
    const input = searchArgs(args);
    let books = [];
    if (args.books !== undefined) {
      if (!Array.isArray(args.books) || args.books.length > 20)
        throw new Error('books must be an array with at most 20 aliases.');
      books = expandHadithBookScopes(args.books);
    }
    const filters = books.length ? books : ['hadith', 'sirah'];
    const page = await HadithMcpSearch.searchPage({
      scope: 'hadith',
      query: input.query,
      filters,
      searchOptions: { excludeQuranAndTafsir: true },
      limit: input.limit,
      cursor: input.cursor,
      offset: input.offset,
      mapItem: item => normalizeHadithSearchItem(item, urls.hadith),
      key: item => item.reference || String(item.id || '')
    }, { search: context.search, deadlineMs: context.deadlineMs });
    return result({ query: input.query, offset: page.pagination.offset, pagination: page.pagination, books, results: page.results }, `Found ${page.results.length} hadith results.`);
  }
  if (name === 'lookup_hadith_detail') {
    const reference = requiredString(args.reference, 'reference').replace(/^\/+/, '').toLowerCase();
    if (!Research.isHadithReference(reference))
      throw new Error('reference must look like bukhari:1, muslim:1907, ahmad:1.6, or malik:13-2.');
    const response = await fetchJson(`${urls.hadith}/${encodeURI(reference)}?json=1`, fetchOptions);
    if (!Array.isArray(response.data) || !response.data[0])
      throw new Error(`Hadith ${reference} was not found.`);
    const profile = responseProfile(args, 'compact');
    const records = response.data.map(item => normalizeScriptureItem(item, urls.hadith, {
      detail: profile !== 'compact',
      inventory: true,
      profile
    }));
    return result({ requested_reference: reference, canonical_url: response.finalUrl.replace(/\?json=1$/, ''), response_profile: profile, records }, `Found ${records.length} record${records.length === 1 ? '' : 's'} for ${reference}.`);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function expandHadithBookScopes(books) {
  const requested = books.map(book => requiredString(book, 'book alias'));
  const historicalScope = requested.some(book => ['sirah', 'history'].includes(normalizedKey(book)));
  if (!historicalScope)
    return Array.from(new Set(requested));
  const historicalAliases = (global.books || [])
    .filter(book => book && ['sirah', 'history'].includes(normalizedKey(book.type)))
    .map(book => requiredString(book.alias, 'book alias'));
  const explicit = requested.filter(book => !['sirah', 'history'].includes(normalizedKey(book)));
  return Array.from(new Set(historicalAliases.length ? [...explicit, ...historicalAliases] : [...explicit, 'sirah']));
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
