'use strict';
const Mcp = require('../lib/HadithMcp');
const baseUrls = { hadith: 'https://hadith.example', quran: 'https://quran.example' };

function lookup(reference, available, missingStatus = 200) {
  const fetch = jest.fn(async url => {
    const ref = new URL(url).pathname.slice(1);
    const found = available.includes(ref);
    return { ok: found || missingStatus === 200, status: found ? 200 : missingStatus, url,
      text: async () => JSON.stringify(found ? [{ ref, body_en: 'Report' }] : []) };
  });
  return { fetch, result: Mcp.callTool('lookup_hadith_detail', { reference }, { baseUrls, fetch }) };
}

test.each([
  ['muslim:2436a', 'muslim:2436a', 1],
  ['muslim:2436a', 'muslim:2436', 2],
  ['muslim:2436', 'muslim:2436a', 2],
  ['muslim:2436', 'muslim:2436c', 4],
  ['muslim:2436b', 'muslim:2436c', 4]
])('resolves %s to %s while preserving identity', async (requested, matched, calls) => {
  const { fetch, result } = lookup(requested, [matched]);
  const data = (await result).structuredContent;
  expect(data.requested_reference).toBe(requested);
  expect(data.records[0].reference).toBe(matched);
  expect(data.canonical_url).toBe(`${baseUrls.hadith}/${matched}`);
  expect(fetch).toHaveBeenCalledTimes(calls);
});

test('falls back after HTTP 404', async () => {
  const { result } = lookup('muslim:2436a', ['muslim:2436'], 404);
  expect((await result).structuredContent.records[0].reference).toBe('muslim:2436');
});

test('tries all suffixes before reporting not found', async () => {
  const { fetch, result } = lookup('muslim:2436', []);
  await expect(result).rejects.toThrow('Hadith muslim:2436 was not found');
  expect(fetch).toHaveBeenCalledTimes(27);
});

test('does not mask server failures as missing references', async () => {
  const { fetch, result } = lookup('muslim:2436', [], 500);
  await expect(result).rejects.toThrow('HTTP 500');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('does not rewrite compound numbering', async () => {
  const { fetch, result } = lookup('malik:13-2', []);
  await expect(result).rejects.toThrow('was not found');
  expect(fetch).toHaveBeenCalledTimes(1);
});
