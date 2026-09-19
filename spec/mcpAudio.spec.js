'use strict';

const HadithMcp = require('../lib/HadithMcp');
const baseUrls = { quran: 'https://quran.example', hadith: 'https://hadith.example' };
const recitations = [
  { id: 'juhani', label: 'Juhani', reciter_name: 'Abdullah al-Juhani' },
  { id: 'other', label: 'Other reciter', reciter_name: 'Another Reader' }
];
function context(audio, reciters = recitations) {
  return {
    baseUrls,
    fetch: jest.fn(async url => ({
      ok: true, status: 200, url,
      text: async () => JSON.stringify(url.includes('/recitations') ? { recitations: reciters } : { audio })
    }))
  };
}
function segment(ayah, startMs, endMs) {
  return { verseKey: `2:${ayah}`, ayah, url: 'https://audio.example/002.mp3', startMs, endMs };
}

test('discovers reciters from the enabled catalog and declares Juhani as default', async () => {
  const result = await HadithMcp.callTool('list_quran_reciters', {}, context([]));
  expect(result.structuredContent).toEqual({ default_reciter: 'juhani', reciters: [
    { alias: 'juhani', name: 'Abdullah al-Juhani' },
    { alias: 'other', name: 'Another Reader' }
  ] });
  expect(result.content[0].text).toContain('Another Reader');
});

test('defaults to Juhani and a single ayah with seconds only in the playback fragment', async () => {
  const ctx = context([segment(255, 1001, 5005)]);
  const result = await HadithMcp.callTool('get_quran_audio', { surah: 2, ayah_from: 255 }, ctx);
  expect(ctx.fetch.mock.calls[1][0]).toBe('https://quran.example/quran/api/proxy/quran-audio/passage?s=2&from=255&to=255&reciter=juhani');
  expect(result.structuredContent).toEqual({
    reciter: { alias: 'juhani', name: 'Abdullah al-Juhani' }, reference: 'quran:2:255',
    audio_url: 'https://audio.example/002.mp3', playback_url: 'https://audio.example/002.mp3#t=1.001,5.005',
    start_ms: 1001, end_ms: 5005,
    segments: [{ reference: 'quran:2:255', start_ms: 1001, end_ms: 5005 }]
  });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
});

test('resolves an exact reciter name and orders an inclusive passage', async () => {
  const ctx = context([segment(256, 5005, 9000), segment(255, 1001, 5005)]);
  const result = await HadithMcp.callTool('get_quran_audio', { surah: 2, ayah_from: 255, ayah_to: 256, reciter: 'Another Reader' }, ctx);
  expect(ctx.fetch.mock.calls[1][0]).toContain('reciter=other');
  expect(result.structuredContent.reference).toBe('quran:2:255-256');
  expect(result.structuredContent.segments.map(item => item.reference)).toEqual(['quran:2:255', 'quran:2:256']);
  expect(result.structuredContent.end_ms).toBe(9000);
});

test.each([
  { surah: 115, ayah_from: 1 },
  { surah: 2, ayah_from: 0 },
  { surah: 2, ayah_from: 2, ayah_to: 1 },
  { surah: 2, ayah_from: 1, ayah_to: 287 }
])('rejects invalid ranges before fetching: %j', async args => {
  const ctx = context([]);
  await expect(HadithMcp.callTool('get_quran_audio', args, ctx)).rejects.toThrow();
  expect(ctx.fetch).not.toHaveBeenCalled();
});

test('does not silently substitute Juhani for an unavailable requested reciter', async () => {
  const ctx = context([]);
  await expect(HadithMcp.callTool('get_quran_audio', { surah: 2, ayah_from: 1, reciter: 'missing' }, ctx)).rejects.toThrow('list_quran_reciters');
  expect(ctx.fetch).toHaveBeenCalledTimes(1);
});

test.each([
  [],
  [segment(255, 1000, 2000)],
  [segment(255, 1000, 2000), segment(256, 3000, 2500)],
  [segment(255, 1000, 2000), { ...segment(256, 2000, 3000), verseKey: '3:256' }],
  [segment(255, 1000, 2000), { ...segment(256, 2000, 3000), url: 'https://audio.example/003.mp3' }]
].map(audio => ({ audio })))('rejects unavailable, incomplete, or invalid audio (%#)', async ({ audio }) => {
  await expect(HadithMcp.callTool('get_quran_audio', { surah: 2, ayah_from: 255, ayah_to: 256 }, context(audio))).rejects.toThrow();
});

test('propagates backend range validation rather than pretending audio exists', async () => {
  const ctx = context([]);
  ctx.fetch.mockImplementationOnce(async url => ({ ok: true, status: 200, url, text: async () => JSON.stringify({ recitations }) }))
    .mockImplementationOnce(async url => ({ ok: false, status: 400, url, text: async () => JSON.stringify({ error: 'Invalid Quran audio request.' }) }));
  await expect(HadithMcp.callTool('get_quran_audio', { surah: 114, ayah_from: 7 }, ctx)).rejects.toThrow('Invalid Quran audio request');
});
