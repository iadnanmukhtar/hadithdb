'use strict';

const express = require('express');
const HadithMcp = require('../lib/HadithMcp');
const Debug = require('../lib/Debug');

describe('public MCP Streamable HTTP route', () => {
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

  async function request(method, body, headers = {}) {
    return fetch(`${baseUrl}/mcp`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  test('advertises the stateless POST transport and protocol version', async () => {
    const options = await request('OPTIONS');
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(options.headers.get('mcp-protocol-version')).toBe(HadithMcp.PROTOCOL_VERSION);

    const get = await request('GET');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
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
        serverInfo: { name: 'HadithDB', version: HadithMcp.SERVER_VERSION }
      })
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
      expect(tool.annotations).toEqual(expect.objectContaining({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }));
    }
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

  test('logs every MCP lookup with its arguments and resolved requester IP at info level', async () => {
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
      }, { 'x-forwarded-for': '203.0.113.27' });

      expect(response.status).toBe(200);
      expect(log.mock.calls.flat().join('\n')).toContain(
        'hadithdb:Mcp INFO: MCP lookup request ip=203.0.113.27 tool=lookup_tafsir arguments={"tafsir":"ibn-kathir","surah":5,"ayah":47,"language":"en"}'
      );
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
    const result = await HadithMcp.callTool('lookup_hadith_detail', { reference: 'bukhari:1' }, { baseUrls: urls, fetch });
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

  test('does not truncate tafsir lookup commentary', async () => {
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

    expect(commentary.text.length).toBeGreaterThan(50000);
    expect(commentary.text.endsWith('commentary')).toBe(true);
    expect(commentary.truncated).toBe(false);
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
