const fs = require('fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('public/static/js/script.js', 'utf8');
let dom, w;
beforeEach(() => {
  dom = new JSDOM('<main data-reader-infinite="hadith-section"></main>', { url: 'https://example.com/history/1/3', runScripts: 'outside-only' });
  w = dom.window;
  w.eval(source.slice(source.indexOf('function bookPrintContext('), source.indexOf('function openContentSharePane(')));
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
});
afterEach(() => dom.window.close());
const signal = { aborted: false };
function page(chapter, section, next, opening = false) {
  const main = w.document.createElement('main');
  if (opening) main.setAttribute('data-book-print-chapter-opening', 'true');
  return { main, context: { path: '/history', chapter, section }, next };
}
test('range defaults follow the current history URL and can switch to chapters', () => {
  w.history.replaceState({}, '', '/history/2/5');
  expect(w.openBookPrintRange()).toBe(true);
  const form = w.document.querySelector('form');
  expect(form.elements.start.value).toBe('5');
  expect(form.elements.end.value).toBe('5');
  expect(w.document.querySelector('[data-chapter]').textContent).toBe('Sections in chapter 2');
  form.elements.kind.value = 'chapters';
  form.elements.kind.dispatchEvent(new w.Event('change'));
  expect(form.elements.start.value).toBe('2');
});
test('single items do not offer a book range', () => {
  w.history.replaceState({}, '', '/history:26');
  expect(w.openBookPrintRange()).toBe(false);
});
test('inclusive section ranges follow pagination but stop before the following section', async () => {
  const load = jest.fn(async url => url.includes('?o=') ? page(1, 2, '/history/1/3') : url.endsWith('/2') ? page(1, 2, '/history/1/2?o=20') : page(1, 3, '/history/1/4'));
  const pages = await w.collectBookPrintRange({ path: '/history', chapter: 1 }, { kind: 'sections', start: 2, end: 3 }, load, signal, () => {});
  expect(pages).toHaveLength(3);
  expect(load.mock.calls.map(c => c[0])).toEqual(['https://example.com/history/1/2', 'https://example.com/history/1/2?o=20', 'https://example.com/history/1/3']);
});
test('chapter pagination keeps download mode and does not duplicate sections', async () => {
  const load = jest.fn(async url => url.includes('o=') ? page(1, null, '/history/1/1') : page(1, null, '/history/1?o=20'));
  expect(await w.collectBookPrintRange({ path: '/history', chapter: 1 }, { kind: 'chapters', start: 1, end: 1 }, load, signal, () => {})).toHaveLength(2);
  expect(load.mock.calls[1][0]).toContain('download=');
});
test('sirah opening chapters include their sections', async () => {
  const load = jest.fn(async url => url.includes('download') ? page(1, null, '/history/1/1', true) : page(1, 1, '/history/2'));
  expect(await w.collectBookPrintRange({ path: '/history', chapter: 1 }, { kind: 'chapters', start: 1, end: 1 }, load, signal, () => {})).toHaveLength(2);
});
test.each([{ start: 3, end: 2 }, { start: -1, end: 1 }, { start: 1.2, end: 3 }])('invalid range rejects before loading: %j', async range => {
  const load = jest.fn();
  await expect(w.collectBookPrintRange({ path: '/history', chapter: 1 }, { kind: 'chapters', ...range }, load, signal, () => {})).rejects.toThrow('valid start');
  expect(load).not.toHaveBeenCalled();
});
test('failures and pagination loops reject rather than returning partial content', async () => {
  const context = { path: '/history', chapter: 1 }, range = { kind: 'sections', start: 1, end: 2 };
  await expect(w.collectBookPrintRange(context, range, async () => { throw Error('Offline'); }, signal, () => {})).rejects.toThrow('Offline');
  await expect(w.collectBookPrintRange(context, range, async () => page(1, 1, '/history/1/1'), signal, () => {})).rejects.toThrow('repeated');
  await expect(w.collectBookPrintRange(context, range, jest.fn(), { aborted: true }, () => {})).rejects.toThrow('Cancelled');
});
test('tafsir ranges stop at section metadata boundaries despite canonical ayah navigation', async () => {
  const context = { path: '/quran/tafsir/easy-tajwid', chapter: 114, sections: [{ section: 1, start: 1 }] };
  const load = jest.fn(async url => ({ main: w.document.createElement('main'), context: { ...context, section: url.includes('quran:114:2') ? 2 : 1 }, next: context.path + '/quran:114:2' }));
  const pages = await w.collectBookPrintRange(context, { kind: 'sections', start: 1, end: 1 }, load, signal, () => {});
  expect(pages).toHaveLength(1);
});
test('tafsir initial markers do not override book metadata; section numbers resolve to verse starts', async () => {
  w.history.replaceState({}, '', '/quran/tafsir/test/quran:2:8');
  w.document.body.innerHTML = '<main data-reader-infinite="tafsir" data-reader-current-url="/quran/tafsir/test/quran:2:8" data-book-print-path="/quran/tafsir/test" data-book-print-chapter="2" data-book-print-section="3"><span data-reader-url="/quran/tafsir/test/quran:2:8"></span></main><script data-quran-heading-outlines type="application/json">{"2":{"sections":[{"section":3,"start":8,"end":20}]}}</script>';
  const context = w.bookPrintContext(w.document, w.location.href);
  expect(context.section).toBe(3);
  const load = jest.fn(async () => ({ main: w.document.createElement('main'), context, next: '' }));
  await w.collectBookPrintRange(context, { kind: 'sections', start: 3, end: 3 }, load, signal, () => {});
  expect(load.mock.calls[0][0]).toBe('https://example.com/quran/tafsir/test/quran:2:8');
});
test.each([[114, 112]])('reverse books print chapters descending for bounds %s–%s, preserving page order', async (start, end) => {
  const context = { path: '/history', chapter: 114, reverseChapters: true };
  const load = jest.fn(async url => {
    const parsed = new URL(url), chapter = Number(parsed.pathname.split('/')[2]);
    const result = page(chapter, null, parsed.searchParams.has('o') ? '' : `/history/${chapter}?o=20`);
    result.main.textContent = `${chapter}:${parsed.searchParams.has('o') ? 2 : 1}`;
    return result;
  });
  const pages = await w.collectBookPrintRange(context, { kind: 'chapters', start, end }, load, signal, () => {});
  expect(pages.map(p => p.textContent)).toEqual(['114:1', '114:2', '113:1', '113:2', '112:1', '112:2']);
});
test('reverse chapters do not reverse sections inside a chapter', async () => {
  const load = jest.fn(async url => page(114, Number(new URL(url).pathname.split('/')[3]), ''));
  await w.collectBookPrintRange({ path: '/history', chapter: 114, reverseChapters: true }, { kind: 'sections', start: 1, end: 2 }, load, signal, () => {});
  expect(load.mock.calls.map(c => c[0])).toEqual(['https://example.com/history/114/1', 'https://example.com/history/114/2']);
});
test('cached Easy Tajwid reads reverse order from catalog metadata and explains it in the dialog', () => {
  w.history.replaceState({}, '', '/quran/tafsir/easy-tajwid/quran:114:1');
  w.document.body.innerHTML = '<main data-reader-infinite="tafsir"></main><script type="application/json" class="quran-tafsir-books-data">[{"slug":"easy-tajwid","surah_dir":1}]</script>';
  expect(w.bookPrintContext(w.document, w.location.href).reverseChapters).toBe(true);
  w.openBookPrintRange();
  expect(w.document.querySelector('[data-chapter]').textContent).toContain('descending order');
  const form = w.document.querySelector('form');
  expect(form.elements.end.max).toBe('114');
  form.elements.end.value = '115';
  expect(form.elements.end.checkValidity()).toBe(false);
  form.elements.end.value = '112';
  expect(form.elements.end.checkValidity()).toBe(true);
  form.elements.kind.value = 'sections';
  form.elements.kind.dispatchEvent(new w.Event('change'));
  expect(form.elements.end.hasAttribute('max')).toBe(false);
  expect(form.elements.end.min).toBe('1');
});

test('reverse chapter ranges reject ascending bounds before loading', async () => {
  const load = jest.fn();
  await expect(w.collectBookPrintRange({ path: '/history', reverseChapters: true }, { kind: 'chapters', start: 112, end: 114 }, load, signal, () => {})).rejects.toThrow('at or below');
  expect(load).not.toHaveBeenCalled();
});
