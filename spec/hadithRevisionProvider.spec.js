'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const HadithRevision = require('../lib/HadithRevision');

describe('hadith revision provider resilience', () => {
  beforeEach(() => {
    axios.post.mockReset();
    global.settings = Object.assign({}, global.settings, {
      openAI: { key: 'test-key' }
    });
  });

  test('retries a transient provider 503 and returns the successful revision', async () => {
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('temporarily unavailable'), {
        response: { status: 503, statusText: 'Service Unavailable', data: {} }
      }))
      .mockResolvedValueOnce({
        data: { choices: [{ message: { content: JSON.stringify({ body: 'متن', body_en: 'Text' }) } }] }
      });

    await expect(HadithRevision.requestOpenAIRevision(
      { ref: 'test:1', chain: '', body: 'متن', footnote: '' },
      false,
      { model: 'test-model', retryAttempts: 2, retryDelayMs: 0 }
    )).resolves.toEqual({ body: 'متن', body_en: 'Text' });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('returns a gateway error after transient provider retries are exhausted', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('temporarily unavailable'), {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: { error: { message: 'Provider overloaded' } }
      }
    }));

    await expect(HadithRevision.requestOpenAIRevision(
      { ref: 'test:2', chain: '', body: 'متن', footnote: '' },
      false,
      { model: 'test-model', retryAttempts: 3, retryDelayMs: 0 }
    )).rejects.toMatchObject({
      status: 502,
      message: 'The AI revision service is temporarily unavailable: Provider overloaded'
    });
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  test('returns the saved revision even when post-save bookkeeping fails', async () => {
    const Utils = require('../lib/Utils');
    const Index = require('../lib/Index');
    const previousQuery = global.query;
    jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
    jest.spyOn(Index, 'update').mockResolvedValue();
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ body: 'متن جديد', body_en: 'Revised text', chain: '', chain_en: '', footnote: '', footnote_en: '' }) } }] } });
    global.query = jest.fn(async sql => {
      if (sql.startsWith('UPDATE hadiths SET')) return { affectedRows: 1 };
      throw new Error('post-save database unavailable');
    });
    try {
      const result = await HadithRevision.reviseHadith({ hId: 123, ref: 'test:1', title_en: 'Existing title', chain: '', body: 'متن', footnote: '' }, { provider: 'openai', model: 'test-model' });
      expect(result.item.body).toBe('متن جديد');
      expect(result.item.body_en).toContain('Revised text');
      expect(global.query.mock.calls[0][0]).toMatch(/^UPDATE hadiths SET/);
      expect(global.query.mock.calls.some(([sql]) => sql.includes('SELECT * FROM v_hadiths'))).toBe(false);
      await new Promise(resolve => setImmediate(resolve));
      expect(Utils.flushCacheContaining).toHaveBeenCalled();
    } finally { global.query = previousQuery; jest.restoreAllMocks(); }
  });

  test('preserves an isnad extracted from a body when the original chain field is empty', async () => {
    const Utils = require('../lib/Utils');
    const Index = require('../lib/Index');
    const previousQuery = global.query;
    const chain = 'عَنْ قَاسِمٍ بن أَبِى حَازِمٍ قَالَ قَالَ عَلِىٌّ';
    const matn = 'كُونُوا بِقَبُولِ الْعَمَلِ أَشَدَّ اهْتِمَامًا مِنْكُم بِالعَمَلِ، فَإِنَّهُ لَنْ يَقِلَّ عَمَلٌ مَعَ التَّقُوى، وَكيْفَ يَقِلُّ عما يُقْبَلُ';
    const body = `"${chain}: ${matn}".`;
    const output = { chain, chain_en: 'Qāsim b. Abī Ḥāzim > ʿAlī', body: matn, body_en: 'Be more concerned with acceptance of the deed.', footnote: '', footnote_en: '' };
    jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
    jest.spyOn(Index, 'update').mockResolvedValue();
    global.query = jest.fn().mockResolvedValue({ affectedRows: 1 });
    axios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(output) } }] } });
    try {
      expect(HadithRevision.countArabicDiacritics(body)).toBe(73);
      expect(HadithRevision.countArabicDiacritics(matn)).toBe(55);
      const result = await HadithRevision.reviseHadith({ hId: 411007, ref: 'suyuti:4-2321b', title_en: 'Existing title', chain: '', body, footnote: '' }, { provider: 'openai', model: 'test-model', forceArabicRevision: true });
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(result.item.chain).toBe(chain);
      expect(result.item.chain_en).toBe(output.chain_en);
      expect(result.item.body).toBe(matn);
      expect(result.arabicRevisionSkipped).toBe(false);
      const writes = global.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE hadiths SET'));
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toContain(`chain='${chain}'`);
      expect(writes[0][0]).toContain(`body='${matn}'`);
      await new Promise(resolve => setImmediate(resolve));
    } finally { global.query = previousQuery; jest.restoreAllMocks(); }
  });

  test('still rejects actual diacritic loss before writing', async () => {
    const previousQuery = global.query;
    global.query = jest.fn();
    axios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify({ chain: '', chain_en: '', body: 'كونوا بقبول العمل أشد اهتماما منكم بالعمل', body_en: 'Text', footnote: '', footnote_en: '' }) } }] } });
    try {
      await expect(HadithRevision.reviseHadith({ ref: 'test:loss', chain: '', body: 'كُونُوا بِقَبُولِ الْعَمَلِ أَشَدَّ اهْتِمَامًا مِنْكُم بِالعَمَلِ', footnote: '' }, { model: 'test-model' })).rejects.toThrow('Model stripped Arabic tashkīl');
      expect(global.query).not.toHaveBeenCalled();
      expect(axios.post).toHaveBeenCalledTimes(1);
    } finally { global.query = previousQuery; }
  });
});
