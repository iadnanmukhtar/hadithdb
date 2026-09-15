'use strict';

const crypto = require('crypto');
const express = require('express');
const HadithMcp = require('../lib/HadithMcp');
const Debug = require('../lib/Debug');

describe('public MCP Streamable HTTP route', () => {
  test('Quran links use exact references instead of decimal SQL section paths', () => {
    const item = HadithMcp.normalizeScriptureItem({ ref: 'quran:1:1', path: 'quran/1.00/1.00' }, 'https://quran.islamunlocked.com');
    expect(item.url).toBe('https://quran.islamunlocked.com/quran:1:1');
  });
  let server;
  let baseUrl;

  beforeAll(async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json({ limit: '1mb' }));
    app.use('/mcp', require('../routes/mcp'));
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server)
      await new Promise(resolve => server.close(resolve));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function request(method, body, headers = {}) {
    const { __omitProtocol, ...requestHeaders } = headers;
    const protocolHeaders = body && body.method !== 'initialize' && !__omitProtocol
      ? { 'MCP-Protocol-Version': HadithMcp.PROTOCOL_VERSION }
      : {};
    return fetch(`${baseUrl}/mcp`, {
      method,
      headers: body === undefined ? requestHeaders : { 'Content-Type': 'application/json', ...protocolHeaders, ...requestHeaders },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  test('advertises the stateless POST transport and protocol version', async () => {
    const options = await request('OPTIONS');
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-methods')).toBeNull();
    expect(options.headers.get('access-control-allow-origin')).toBeNull();
    expect(options.headers.get('mcp-protocol-version')).toBe(HadithMcp.PROTOCOL_VERSION);

    const browserOptions = await request('OPTIONS', undefined, { Origin: 'https://chatgpt.com' });
    expect(browserOptions.status).toBe(204);
    expect(browserOptions.headers.get('access-control-allow-origin')).toBeNull();
    expect(browserOptions.headers.get('access-control-allow-headers')).toBeNull();

    const playgroundOptions = await request('OPTIONS', undefined, { Origin: 'https://mcpplaygroundonline.com' });
    expect(playgroundOptions.status).toBe(204);
    expect(playgroundOptions.headers.get('access-control-allow-origin')).toBeNull();

    const rejectedOrigin = await request('OPTIONS', undefined, { Origin: 'https://evil.example' });
    expect(rejectedOrigin.status).toBe(403);
    expect(rejectedOrigin.headers.get('access-control-allow-origin')).toBeNull();

    const get = await request('GET');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
  });

  test('validates initialize and post-initialize protocol versions', async () => {
    const missingInitializeVersion = await request('POST', {
      jsonrpc: '2.0', id: 'missing-init-version', method: 'initialize', params: {}
    });
    expect(missingInitializeVersion.status).toBe(400);
    expect((await missingInitializeVersion.json()).error.code).toBe(-32600);

    const missingHeader = await request('POST', {
      jsonrpc: '2.0', id: 'missing-header', method: 'ping', params: {}
    }, { __omitProtocol: true });
    expect(missingHeader.status).toBe(400);

    const wrongHeader = await request('POST', {
      jsonrpc: '2.0', id: 'wrong-header', method: 'ping', params: {}
    }, { 'MCP-Protocol-Version': '1900-01-01' });
    expect(wrongHeader.status).toBe(400);
    expect((await wrongHeader.json()).error.message).toContain('Unsupported MCP protocol version');
  });

  test('initializes without a session id', async () => {
    const response = await request('POST', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: HadithMcp.PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'jest', version: '1.0.0' }
      }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      jsonrpc: '2.0',
      id: 1,
      result: expect.objectContaining({
        protocolVersion: HadithMcp.PROTOCOL_VERSION,
        serverInfo: { name: 'HadithDB', version: HadithMcp.SERVER_VERSION },
        capabilities: expect.objectContaining({
          tools: {},
          extensions: { 'io.modelcontextprotocol/skills': {} }
        })
      })
    }));
  });

  test('lists five importable skills with matching resources and SHA-256 digests', async () => {
    const skills = [];
    const pageSizes = [];
    let cursor;
    do {
      const response = await request('POST', {
        jsonrpc: '2.0', id: `skills-list-${skills.length}`, method: 'skills/list', params: cursor ? { cursor } : {}
      });
      const payload = await response.json();
      pageSizes.push(payload.result.skills.length);
      skills.push(...payload.result.skills);
      cursor = payload.result.nextCursor;
    } while (cursor);

    expect(pageSizes).toEqual([3, 2]);
    expect(skills.map(skill => skill.frontmatter.name)).toEqual([
      'companion-biography',
      'fiqh-evidence-and-practice',
      'quran-tafsir-comparison',
      'sirah-history-research',
      'source-aware-islamic-narrative'
    ]);

    for (const skill of skills) {
      expect(skill.uri).toBe(`skill://hadithdb/${skill.frontmatter.name}/SKILL.md`);
      expect(skill.frontmatter.description).toEqual(expect.any(String));
      expect(skill.resources).toHaveLength(1);
      expect(skill.resources[0].uri).toBe(skill.uri);
      expect(skill.resources[0].digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      const readResponse = await request('POST', {
        jsonrpc: '2.0',
        id: `read-${skill.frontmatter.name}`,
        method: 'resources/read',
        params: { uri: skill.uri }
      });
      const readPayload = await readResponse.json();
      expect(readPayload.result.contents).toEqual([
        expect.objectContaining({ uri: skill.uri, mimeType: 'text/markdown', text: expect.any(String) })
      ]);
      const text = readPayload.result.contents[0].text;
      const actualDigest = `sha256:${crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
      expect(actualDigest).toBe(skill.resources[0].digest);
      expect(text).toContain(`name: ${skill.frontmatter.name}`);

      const getResponse = await request('POST', {
        jsonrpc: '2.0',
        id: `get-${skill.frontmatter.name}`,
        method: 'skills/get',
        params: { uri: skill.uri }
      });
      await expect(getResponse.json()).resolves.toEqual(expect.objectContaining({
        result: { skill }
      }));
    }
  });

  test('rejects invalid skill cursors and unknown skill resources as invalid params', async () => {
    const cursorResponse = await request('POST', {
      jsonrpc: '2.0', id: 'bad-cursor', method: 'skills/list', params: { cursor: 'not-issued' }
    });
    expect((await cursorResponse.json()).error).toEqual(expect.objectContaining({
      code: -32602,
      message: 'Invalid skills cursor.'
    }));

    const resourceResponse = await request('POST', {
      jsonrpc: '2.0', id: 'bad-resource', method: 'resources/read', params: { uri: 'skill://hadithdb/missing/SKILL.md' }
    });
    expect((await resourceResponse.json()).error).toEqual(expect.objectContaining({
      code: -32602,
      message: 'Unknown skill resource URI: skill://hadithdb/missing/SKILL.md'
    }));
  });

  test('lists all read-only tools with schemas and annotations', async () => {
    const response = await request('POST', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const payload = await response.json();
    expect(payload.result.tools.map(tool => tool.name)).toEqual([
      'lookup_quran_ayah',
      'search_quran',
      'list_tafsirs',
      'lookup_tafsir',
      'search_tafsir',
      'search_hadith',
      'lookup_hadith_detail'
    ]);
    for (const tool of payload.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema).toEqual(expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({ error: expect.objectContaining({ type: 'string' }) }),
        oneOf: expect.arrayContaining([
          expect.objectContaining({ required: ['error'] })
        ])
      }));
      expect(tool.annotations).toEqual(expect.objectContaining({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }));
    }
    expect(payload.result.tools.find(tool => tool.name === 'lookup_quran_ayah').outputSchema.properties)
      .toHaveProperty('ayah');
    expect(payload.result.tools.find(tool => tool.name === 'search_tafsir').outputSchema.properties.results.items.properties)
      .toEqual(expect.objectContaining({ source: expect.any(Object), text_arabic: expect.any(Object), text_english: expect.any(Object) }));
    for (const name of ['search_quran', 'search_tafsir', 'search_hadith']) {
      const definition = payload.result.tools.find(tool => tool.name === name);
      expect(definition.inputSchema.properties).toHaveProperty('cursor');
      expect(definition.outputSchema.properties.pagination.properties).toEqual(expect.objectContaining({
        next_cursor: expect.any(Object),
        has_more: expect.any(Object),
        total_is_exact: expect.any(Object)
      }));
    }
    expect(payload.result.tools.find(tool => tool.name === 'lookup_tafsir').outputSchema.properties)
      .toEqual(expect.objectContaining({ response_profile: expect.any(Object), availability: expect.any(Object) }));
    const hadithDetail = payload.result.tools.find(tool => tool.name === 'lookup_hadith_detail');
    expect(hadithDetail.description).toContain('available with response_profile: "full"');
    expect(hadithDetail.description).not.toContain('Retrieve the full');
    expect(hadithDetail.outputSchema.properties)
      .toEqual(expect.objectContaining({ requested_reference: expect.any(Object), canonical_url: expect.any(Object), response_profile: expect.any(Object), records: expect.any(Object) }));
    const listTafsirs = payload.result.tools.find(tool => tool.name === 'list_tafsirs');
    expect(listTafsirs.inputSchema.properties).toHaveProperty('cursor');
    expect(listTafsirs.outputSchema.properties).toEqual(expect.objectContaining({
      total: expect.any(Object), has_more: expect.any(Object), next_cursor: expect.any(Object)
    }));
  });

  test('dispatches tool calls and returns model-readable structured content', async () => {
    const call = jest.spyOn(HadithMcp, 'callTool').mockResolvedValueOnce({
      structuredContent: { ayah: { reference: 'quran:2:255' } },
      content: [{ type: 'text', text: 'Found Quran 2:255.' }]
    });
    const response = await request('POST', {
      jsonrpc: '2.0',
      id: 'tool-1',
      method: 'tools/call',
      params: { name: 'lookup_quran_ayah', arguments: { surah: 2, ayah: 255 } }
    });
    const payload = await response.json();
    expect(payload.result.structuredContent.ayah.reference).toBe('quran:2:255');
    expect(call).toHaveBeenCalledWith('lookup_quran_ayah', { surah: 2, ayah: 255 }, expect.objectContaining({ req: expect.any(Object) }));
  });

  test('logs redacted request metadata with request IDs, status, latency, and retention', async () => {
    const originalLog = Debug.log;
    const log = jest.fn();
    Debug.log = log;
    jest.spyOn(HadithMcp, 'callTool').mockResolvedValueOnce({
      structuredContent: { reference: 'quran:5:47', commentary: [] },
      content: [{ type: 'text', text: 'Found Ibn Kathir for Quran 5:47.' }]
    });

    try {
      const response = await request('POST', {
        jsonrpc: '2.0',
        id: 'logged-tool',
        method: 'tools/call',
        params: {
          name: 'lookup_tafsir',
          arguments: { tafsir: 'ibn-kathir', surah: 5, ayah: 47, language: 'en' }
        }
      }, { 'x-forwarded-for': '203.0.113.27', 'x-request-id': 'mcp-test-request-123' });

      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toBe('mcp-test-request-123');
      const logs = log.mock.calls.flat().join('\n');
      expect(logs).toMatch(/request_id=mcp-test-request-123 method=tools\/call tool=lookup_tafsir status=200 latency_ms=[0-9.]+ outcome=success retention_days=30/);
      expect(logs).not.toContain('203.0.113.27');
      expect(logs).not.toContain('ibn-kathir');
      expect(logs).not.toContain('arguments');
    } finally {
      Debug.log = originalLog;
    }
  });

  test('accepts initialized notifications with HTTP 202', async () => {
    const response = await request('POST', { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(response.status).toBe(202);
  });

  test('returns JSON-RPC errors for invalid requests and unknown tools', async () => {
    const invalid = await request('POST', { hello: 'world' });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe(-32600);

    const unknown = await request('POST', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} }
    });
    expect(unknown.status).toBe(200);
    expect((await unknown.json()).error.code).toBe(-32602);

    const badArguments = await request('POST', {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'lookup_quran_ayah', arguments: { surah: '2', ayah: 255 } }
    });
    expect(badArguments.status).toBe(200);
    expect((await badArguments.json()).error).toEqual(expect.objectContaining({
      code: -32602,
      message: 'surah must be an integer.'
    }));
  });

  test('rejects oversized parsed requests', async () => {
    const response = await request('POST', {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
      params: { padding: 'x'.repeat(70 * 1024) }
    });
    expect(response.status).toBe(413);
  });
});

describe('Hadith MCP tool service', () => {
  const urls = { hadith: 'https://hadith.example', quran: 'https://quran.example' };

  function response(data, url) {
    return {
      ok: true,
      status: 200,
      url,
      text: async () => JSON.stringify(data)
    };
  }

  test('preserves the Quran 1:0 exception', async () => {
    let requested;
    const fetch = async url => {
      requested = String(url);
      return response([{ id: 1, ref: 'quran:1:0', book_alias: 'quran', num: '1:0', body: 'أَعُوذُ بِاللَّهِ' }], requested);
    };
    const result = await HadithMcp.callTool('lookup_quran_ayah', { surah: 1, ayah: 0 }, { baseUrls: urls, fetch });
    expect(requested).toBe('https://quran.example/quran:1:0?json=1');
    expect(result.structuredContent.ayah.reference).toBe('quran:1:0');
    await expect(HadithMcp.callTool('lookup_quran_ayah', { surah: 2, ayah: 0 }, { baseUrls: urls, fetch }))
      .rejects.toThrow('only for Surah 1');
  });

  test('returns Quran ayah text and its translation through the bilingual contract', async () => {
    const fetch = async url => response([{
      id: 255,
      ref: 'quran:2:255',
      book_alias: 'quran',
      num: '2:255',
      body: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ',
      body_en: 'Allah—there is no deity except Him.'
    }], String(url));

    const result = await HadithMcp.callTool('lookup_quran_ayah', { surah: 2, ayah: 255 }, { baseUrls: urls, fetch });

    expect(result.structuredContent.ayah).toEqual(expect.objectContaining({
      bilingual: true,
      text_arabic: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ',
      text_english: 'Allah—there is no deity except Him.',
      truncated: false
    }));
  });

  test('normalizes a detailed hadith response and canonical URL', async () => {
    const fetch = async url => response([{
      id: 1,
      ref: 'bukhari:1',
      book_alias: 'bukhari',
      num: '1',
      body_en: 'Actions are by intentions.',
      body: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ',
      grade_grade_en: 'Agreed Upon',
      hdithMetadata: {
        narrators: [{ name: 'Umar' }],
        sharh: [{
          id: 10,
          title: 'فتح الباري',
          title_en: 'Fath al-Bari',
          text: 'شرح عربي كامل',
          text_en: 'Complete English explanation'
        }]
      }
    }], String(url));
    const result = await HadithMcp.callTool('lookup_hadith_detail', {
      reference: 'bukhari:1', response_profile: 'full'
    }, { baseUrls: urls, fetch });
    expect(result.structuredContent.records[0]).toEqual(expect.objectContaining({
      reference: 'bukhari:1',
      url: 'https://hadith.example/bukhari:1',
      bilingual: true,
      text_arabic: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ',
      text_english: 'Actions are by intentions.',
      truncated: false,
      metadata: expect.objectContaining({
        narrators: [{ name: 'Umar' }],
        sharh: [expect.objectContaining({
          bilingual: true,
          title_arabic: 'فتح الباري',
          title_english: 'Fath al-Bari',
          text: 'شرح عربي كامل',
          text_en: 'Complete English explanation',
          text_arabic: 'شرح عربي كامل',
          text_english: 'Complete English explanation',
          text_combined: 'Complete English explanation\n\nشرح عربي كامل',
          truncated: false
        })]
      })
    }));
    expect(result.structuredContent.canonical_url).toBe('https://hadith.example/bukhari:1');
  });

  test.each(['sirah', 'history'])('searches every sirah and history book for the %s scope', async scope => {
    const previousBooks = global.books;
    global.books = [
      { alias: 'ibnhisham', type: 'sirah' },
      { alias: 'islamweb-history', type: 'history' },
      { alias: 'bukhari', type: 'hadith' }
    ];
    let requestedFilters;
    let requestedOptions;
    const search = async (query, filters, offset, options) => {
      requestedFilters = filters;
      requestedOptions = options;
      return [];
    };

    try {
      const result = await HadithMcp.callTool('search_hadith', {
        query: 'migration',
        books: [scope]
      }, { baseUrls: urls, search });

      expect(requestedFilters).toEqual(['ibnhisham', 'islamweb-history']);
      expect(requestedOptions).toEqual(expect.objectContaining({
        excludeQuranAndTafsir: true,
        resultSize: 100,
        resultLimit: 600,
        redactLogs: true
      }));
      expect(result.structuredContent.books).toEqual(['ibnhisham', 'islamweb-history']);
      expect(result.structuredContent.pagination).toEqual(expect.objectContaining({
        returned: 0,
        has_more: false,
        total_available: 0,
        total_is_exact: true
      }));
    } finally {
      global.books = previousBooks;
    }
  });

  test('honors exact search limits and opaque query-bound cursors', async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      ref: `bukhari:${index + 1}`,
      book_alias: 'bukhari',
      num: String(index + 1),
      body_en: `Result ${index + 1}`
    }));
    const search = async (query, filters, offset, options) => {
      const page = items.slice(offset, offset + options.resultSize);
      page.total = items.length;
      return page;
    };

    const first = await HadithMcp.callTool('search_hadith', { query: 'result', limit: 2 }, { baseUrls: urls, search });
    expect(first.structuredContent.results.map(item => item.reference)).toEqual(['bukhari:1', 'bukhari:2']);
    expect(first.structuredContent.pagination).toEqual(expect.objectContaining({
      limit: 2,
      returned: 2,
      offset: 0,
      has_more: true,
      next_cursor: expect.any(String)
    }));

    const second = await HadithMcp.callTool('search_hadith', {
      query: 'result',
      limit: 2,
      cursor: first.structuredContent.pagination.next_cursor
    }, { baseUrls: urls, search });
    expect(second.structuredContent.results.map(item => item.reference)).toEqual(['bukhari:3', 'bukhari:4']);
    expect(second.structuredContent.pagination.offset).toBe(2);

    await expect(HadithMcp.callTool('search_hadith', {
      query: 'different query',
      limit: 2,
      cursor: first.structuredContent.pagination.next_cursor
    }, { baseUrls: urls, search })).rejects.toThrow('Invalid search cursor.');
  });

  test('bounds deep pagination by logical offset, scanned pages, and deadline', async () => {
    const untouchedSearch = jest.fn();
    await expect(HadithMcp.callTool('search_hadith', {
      query: 'result', offset: 501
    }, { baseUrls: urls, search: untouchedSearch })).rejects.toThrow('Pagination depth exceeded');
    expect(untouchedSearch).not.toHaveBeenCalled();

    const duplicateSearch = jest.fn(async (query, filters, offset, options) => {
      const page = Array.from({ length: options.resultSize }, (_, index) => ({
        id: offset + index + 1,
        ref: 'bukhari:1',
        book_alias: 'bukhari',
        body_en: 'Same logical record'
      }));
      page.total = 10000;
      return page;
    });
    await expect(HadithMcp.callTool('search_hadith', {
      query: 'result', offset: 10
    }, { baseUrls: urls, search: duplicateSearch })).rejects.toThrow('Pagination depth exceeded');
    expect(duplicateSearch).toHaveBeenCalledTimes(6);

    const slowSearch = () => new Promise(resolve => setTimeout(() => resolve([]), 30));
    await expect(HadithMcp.callTool('search_hadith', {
      query: 'result'
    }, { baseUrls: urls, search: slowSearch, deadlineMs: 5 })).rejects.toThrow('Search request deadline exceeded');
  });

  test('continues dedicated MCP searches beyond the website page cap', async () => {
    const items = Array.from({ length: 105 }, (_, index) => ({
      id: index + 1,
      ref: `muslim:${index + 1}`,
      book_alias: 'muslim',
      num: String(index + 1),
      body_en: `Result ${index + 1}`
    }));
    const offsets = [];
    const search = async (query, filters, offset, options) => {
      offsets.push(offset);
      const page = items.slice(offset, offset + options.resultSize);
      page.total = items.length;
      return page;
    };

    const result = await HadithMcp.callTool('search_hadith', {
      query: 'result', limit: 2, offset: 99
    }, { baseUrls: urls, search });

    expect(offsets).toEqual([0, 100]);
    expect(result.structuredContent.results.map(item => item.reference)).toEqual(['muslim:100', 'muslim:101']);
    expect(result.structuredContent.pagination).toEqual(expect.objectContaining({
      offset: 99,
      returned: 2,
      total_available: 105,
      total_is_exact: true,
      has_more: true
    }));
  });

  test('deduplicates Quran results by canonical ayah and merges translation matches', async () => {
    let requestedFilters;
    const raw = [
      { id: 1, ref: 'quran:1:1', book_alias: 'quran', num: '1:1', body: 'بِسْمِ اللَّهِ', body_en: 'In the name of Allah' },
      { id: 2, ref: 'quran:1:1', commentary_type: 'trans', commentary_alias: 'clear-quran', commentary_name_en: 'The Clear Quran', content_translation_language: 'en', translation_body_html: '<p>In the Name of Allah</p>' },
      { id: 3, ref: 'quran:1:1', commentary_type: 'trans', commentary_alias: 'sahih-international', commentary_name_en: 'Sahih International', content_translation_language: 'en', translation_body_html: '<p>In the name of Allah</p>' },
      { id: 4, ref: 'quran:1:2', book_alias: 'quran', num: '1:2', body: 'الْحَمْدُ لِلَّهِ', body_en: 'All praise is for Allah' }
    ];
    const search = async (query, filters) => {
      requestedFilters = filters;
      const results = raw.slice();
      results.total = results.length;
      return results;
    };

    const result = await HadithMcp.callTool('search_quran', { query: 'Allah', limit: 2 }, { baseUrls: urls, search });
    expect(requestedFilters).toEqual(['quran', 'translations']);
    expect(result.structuredContent.results).toHaveLength(2);
    expect(result.structuredContent.results[0]).toEqual(expect.objectContaining({
      reference: 'quran:1:1',
      text_arabic: 'بِسْمِ اللَّهِ',
      translation_matches: [
        expect.objectContaining({ source_alias: 'clear-quran' }),
        expect.objectContaining({ source_alias: 'sahih-international' })
      ]
    }));
    expect(new Set(result.structuredContent.results.map(item => item.reference)).size).toBe(2);
  });

  test('hydrates translation-only Quran search results from the canonical ayah', async () => {
    const raw = [{
      id: 9,
      ref: 'quran:2:128',
      commentary_type: 'trans',
      commentary_alias: 'clear-quran',
      commentary_name_en: 'The Clear Quran',
      content_translation_language: 'en',
      translation_body_html: '<p>Our Lord! Make us submit to You.</p>'
    }];
    const search = async () => {
      const results = raw.slice();
      results.total = results.length;
      return results;
    };
    const fetch = jest.fn(async url => response([{
      id: 128,
      ref: 'quran:2:128',
      path: 'quran:2:128',
      book_alias: 'quran',
      book_name_en: 'The Quran',
      book_name: 'القرآن',
      num: '2:128',
      numInChapter: 128,
      h1: 2,
      h1_title_en: 'Al-Baqarah',
      h1_title: 'البقرة',
      body: 'رَبَّنَا وَاجْعَلْنَا مُسْلِمَيْنِ لَكَ',
      body_en: 'Our Lord, make us both submit to You.'
    }], String(url)));

    const result = await HadithMcp.callTool('search_quran', {
      query: 'mercy', limit: 1, sort: 'canonical'
    }, { baseUrls: urls, search, fetch });
    const item = result.structuredContent.results[0];

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://quran.example/quran:2:128?json=1');
    expect(item).toEqual(expect.objectContaining({
      reference: 'quran:2:128',
      text_arabic: 'رَبَّنَا وَاجْعَلْنَا مُسْلِمَيْنِ لَكَ',
      text_english: 'Our Lord, make us both submit to You.',
      bilingual: true,
      book: expect.objectContaining({
        alias: 'quran',
        name_english: 'The Quran',
        name_arabic: 'القرآن'
      }),
      translation_matches: [expect.objectContaining({
        source_alias: 'clear-quran',
        text: 'Our Lord! Make us submit to You.'
      })]
    }));
    expect(item).not.toHaveProperty('_quran_base_present');
  });

  test('does not truncate Arabic or English scripture fields', () => {
    const longEnglish = 'e'.repeat(25000);
    const longArabic = 'ع'.repeat(25000);
    const item = HadithMcp.normalizeScriptureItem({
      ref: 'bukhari:1',
      book_alias: 'bukhari',
      chain_en: longEnglish,
      body_en: longEnglish,
      footnote_en: longEnglish,
      chain: longArabic,
      body: longArabic,
      footnote: longArabic
    }, urls.hadith, { detail: true });

    expect(item.english).toEqual(expect.objectContaining({
      chain: longEnglish,
      body: longEnglish,
      footnote: longEnglish
    }));
    expect(item.arabic).toEqual(expect.objectContaining({
      chain: longArabic,
      body: longArabic,
      footnote: longArabic
    }));
    expect(item).toEqual(expect.objectContaining({
      bilingual: true,
      text_arabic: `${longArabic}\n\n${longArabic}\n\n${longArabic}`,
      text_english: `${longEnglish}\n\n${longEnglish}\n\n${longEnglish}`,
      truncated: false
    }));
  });

  test('applies explicit and named response profiles to long tafsir commentary', async () => {
    const longCommentary = `<p>${'commentary '.repeat(6000)}</p>`;
    const fetch = async url => {
      if (String(url).endsWith('/quran/api/proxy/tafsir/books')) {
        return response([{ type: 'tafsir', source: 'local', alias: 'long-tafsir', lang: 'en' }], String(url));
      }
      return response({ entries: [{ id: 1, html: longCommentary, content_translation_language: 'en' }] }, String(url));
    };

    const result = await HadithMcp.callTool('lookup_tafsir', {
      tafsir: 'long-tafsir',
      surah: 1,
      ayah: 1,
      max_chars: 500
    }, { baseUrls: urls, fetch });
    const commentary = result.structuredContent.commentary[0];

    expect(commentary.text.length).toBeLessThanOrEqual(500);
    expect(commentary.text.endsWith('…')).toBe(true);
    expect(commentary.truncated).toBe(true);

    const full = await HadithMcp.callTool('lookup_tafsir', {
      tafsir: 'long-tafsir',
      surah: 1,
      ayah: 1,
      response_profile: 'full'
    }, { baseUrls: urls, fetch });
    expect(full.structuredContent.response_profile).toBe('full');
    expect(full.structuredContent.commentary[0].text.length).toBeGreaterThan(50000);
    expect(full.structuredContent.commentary[0].truncated).toBe(false);
  });

  test('falls back to an available tafsir language and reports availability', async () => {
    const fetch = async url => {
      const requested = new URL(String(url));
      if (requested.pathname.endsWith('/quran/api/proxy/tafsir/books')) {
        return response([
          { type: 'tafsir', source: 'local', alias: 'bilingual-tafsir', lang: 'en' },
          { type: 'tafsir', source: 'local', alias: 'bilingual-tafsir', lang: 'ar' }
        ], String(url));
      }
      if (requested.searchParams.get('lang') === 'en')
        return response({ entries: [] }, String(url));
      return response({ entries: [{ id: 1, html: '<p>تفسير عربي</p>', content_translation_language: 'ar' }] }, String(url));
    };

    const result = await HadithMcp.callTool('lookup_tafsir', {
      tafsir: 'bilingual-tafsir', surah: 1, ayah: 1, language: 'en'
    }, { baseUrls: urls, fetch });

    expect(result.structuredContent.availability).toEqual({
      requested_language: 'en',
      resolved_language: 'ar',
      fallback_used: true,
      available_languages: ['ar', 'en'],
      has_arabic: true,
      has_english: false
    });
    expect(result.structuredContent.commentary[0].text_arabic).toBe('تفسير عربي');
  });

  test('paginates the tafsir catalog with query-bound cursors', async () => {
    const rows = Array.from({ length: 57 }, (_, index) => ({
      type: 'tafsir',
      source: 'local',
      alias: `tafsir-${String(index + 1).padStart(2, '0')}`,
      lang: index % 2 ? 'ar' : 'en',
      name_en: `Tafsir ${index + 1}`
    }));
    const fetch = async url => response(rows, String(url));

    const first = await HadithMcp.callTool('list_tafsirs', { limit: 20 }, { baseUrls: urls, fetch });
    expect(first.structuredContent).toEqual(expect.objectContaining({
      total: 57,
      has_more: true,
      next_cursor: expect.any(String)
    }));
    expect(first.structuredContent.tafsirs).toHaveLength(20);
    expect(first.content[0].text).toContain('Total: 57. More: yes.');

    const second = await HadithMcp.callTool('list_tafsirs', {
      limit: 20,
      cursor: first.structuredContent.next_cursor
    }, { baseUrls: urls, fetch });
    expect(second.structuredContent.tafsirs[0].alias).toBe('tafsir-21');

    await expect(HadithMcp.callTool('list_tafsirs', {
      query: 'different',
      cursor: first.structuredContent.next_cursor
    }, { baseUrls: urls, fetch })).rejects.toThrow('Invalid search cursor.');
  });

  test('reports commentary language as the resolved presentation language', async () => {
    const fetch = async url => {
      if (String(url).endsWith('/quran/api/proxy/tafsir/books'))
        return response([{ type: 'tafsir', source: 'local', alias: 'ibn-kathir', lang: 'ar' }], String(url));
      return response({
        entries: [{
          id: 1,
          content_translation_language: 'en',
          arabic_html: '<p>تفسير عربي</p>',
          translation_html: '<p>English translation</p>'
        }]
      }, String(url));
    };

    const result = await HadithMcp.callTool('lookup_tafsir', {
      tafsir: 'ibn-kathir', surah: 1, ayah: 1, language: 'ar'
    }, { baseUrls: urls, fetch });

    expect(result.structuredContent.availability).toEqual(expect.objectContaining({
      requested_language: 'ar', resolved_language: 'ar', fallback_used: false
    }));
    expect(result.structuredContent.commentary[0].language).toBe('ar');
  });

  test('compact hadith detail is the default and default metadata is bounded', async () => {
    const fetch = async url => response([{
      id: 1,
      ref: 'bukhari:1',
      book_alias: 'bukhari',
      num: '1',
      body_en: 'Actions are by intentions.',
      hdithMetadata: { narrators: [{ name: 'Umar' }], sharh: [{ text_en: 'Explanation' }] }
    }], String(url));

    const compact = await HadithMcp.callTool('lookup_hadith_detail', { reference: 'bukhari:1' }, { baseUrls: urls, fetch });
    expect(compact.structuredContent.response_profile).toBe('compact');
    expect(compact.structuredContent.records[0]).not.toHaveProperty('metadata');

    const normal = await HadithMcp.callTool('lookup_hadith_detail', {
      reference: 'bukhari:1', response_profile: 'default'
    }, { baseUrls: urls, fetch });
    expect(normal.structuredContent.response_profile).toBe('default');
    expect(normal.structuredContent.records[0]).toHaveProperty('metadata');
    expect(normal.structuredContent.records[0].metadata.sharh[0].text_english).toBe('Explanation');
    expect(normal.structuredContent.records[0].metadata.sharh[0]).not.toHaveProperty('text_en');
    expect(normal.content[0].text).toContain('Actions are by intentions.');
    expect(normal.content[0].text.length).toBeLessThanOrEqual(12000);
  });

  test('returns bilingual tafsir in separate full Arabic and English fields', async () => {
    const arabic = 'تفسير عربي كامل';
    const english = 'Complete English commentary';
    const fetch = async url => {
      if (String(url).endsWith('/quran/api/proxy/tafsir/books')) {
        return response([{ type: 'tafsir', source: 'local', alias: 'ibn-kathir', lang: 'en' }], String(url));
      }
      return response({
        id: 47,
        ayahs_start: 47,
        count: 0,
        bilingual: true,
        content_translation_language: 'en',
        html: `<section lang="en">${english}</section><section lang="ar">${arabic}</section>`,
        arabic_html: `<p>${arabic}</p>`,
        translation_html: `<p>${english}</p>`
      }, String(url));
    };

    const result = await HadithMcp.callTool('lookup_tafsir', {
      tafsir: 'ibn-kathir',
      surah: 5,
      ayah: 47,
      language: 'en'
    }, { baseUrls: urls, fetch });
    const commentary = result.structuredContent.commentary[0];

    expect(commentary).toEqual(expect.objectContaining({
      bilingual: true,
      language: 'en',
      text_arabic: arabic,
      text_english: english,
      truncated: false
    }));
    expect(commentary.text).toContain(arabic);
    expect(commentary.text).toContain(english);
  });
});
