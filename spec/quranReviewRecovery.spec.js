'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');

async function openReview(fetch) {
  const dom = new JSDOM(`<article data-quran-mushaf-page="42"><div data-quran-ayah-review-rating data-quran-ref="2:255"><div class="quran-ayah-review-buttons"><button data-quran-review-reveal>Reveal</button></div><div class="quran-review-session-actions"><button disabled>Pause</button></div><div data-quran-review-status></div></div></article>`, { url:'https://example.com/quran/page/42?review=2:255', runScripts:'outside-only' });
  const w = dom.window;
  w.HadithDbQuranReview = { localDayStart: () => '2026-10-27' };
  w.hadithAuth = { getToken: async () => 'token' };
  w.quranApiPath = w.quranUrl = path => path;
  w.trackQuranAnalyticsEvent = jest.fn();
  w.navigateWithPageNotice = jest.fn();
  w.requestAnimationFrame = jest.fn();
  w.fetch = fetch;
  w.eval(source.slice(source.indexOf('function initQuranAyahReview('), source.indexOf('function initPageHelpTips(')));
  w.initQuranAyahReview();
  await new Promise(resolve => setTimeout(resolve, 0));
  return dom;
}

test('an inactive ayah returns to Mudhakkir without starting a session or enabling grading', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok:false, status:404, json:async () => ({error:'This ayah is not the active review item.'}) });
  const dom = await openReview(fetch), w = dom.window;
  expect(w.navigateWithPageNotice).toHaveBeenCalledWith('/quran/review', expect.objectContaining({type:'info'}), expect.any(String));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(w.document.querySelector('.quran-ayah-review-buttons button').disabled).toBe(true);
  dom.window.close();
});

test('a transient restore failure offers retry and enables controls only after successful restoration', async () => {
  const fetch = jest.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ ok:true, status:200, json:async () => ({session_id:'session', attempt_token:'attempt', reviewed_refs:[]}) });
  const dom = await openReview(fetch), w = dom.window, status = w.document.querySelector('[data-quran-review-status]');
  expect(status.textContent).toContain('Network unavailable');
  expect(status.querySelector('a').getAttribute('href')).toBe('/quran/review');
  expect(w.document.querySelector('.quran-ayah-review-buttons button').disabled).toBe(true);
  status.querySelector('button').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(status.textContent).toBe('');
  expect(w.document.querySelector('.quran-ayah-review-buttons button').disabled).toBe(false);
  expect(w.navigateWithPageNotice).not.toHaveBeenCalled();
  dom.window.close();
});
