'use strict';
const Sharh = require('../lib/Sharh');
const Index = require('../lib/Index');
beforeEach(() => {
 jest.spyOn(require('../lib/Utils'), 'diskCacheEnabled').mockReturnValue(false);
 jest.spyOn(Index, 'docFromId').mockResolvedValue(null);
 jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([]);
});
const router = require('../routes/sharh');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const book = { id: 100, alias: 'fath-al-bari', type: 'sharh', shortName_en: 'Fath al-Bari', shortName: 'فتح الباري', properties: { sharh: { source_id: 4, source_title: '' } } };
function handler(route) { return router.stack.find(layer => layer.route?.path === route).route.stack[0].handle; }
function response() { return { render: jest.fn(), redirect: jest.fn(), sendStatus: jest.fn() }; }
afterEach(() => { jest.restoreAllMocks(); delete global.query; delete global.books; });

test('hadith and heading IDs have separate canonical paths and retain imported identities', () => {
 global.books = [book];
 expect(Sharh.decorate({ id: 7, source_id: 4, source_book_id: 5, title: 'Edited', hadith_ref: 'bukhari:100' }).full_page_url).toBe('/sharh/fath-al-bari/bukhari:100');
 expect(Sharh.decorate({ id: 7, source_id: 4, source_book_id: 5 }, 'heading').full_page_url).toBe('/sharh/fath-al-bari/heading/7');
 expect(Sharh.decorate({ id: 8, source_id: 99 }).full_page_url).toBeNull();
});

test.each(['0', '-1', '1 OR 1=1', '1.5', '9007199254740992'])('rejects invalid entry ID %s before SQL', async id => {
 global.query = jest.fn();
 expect(await Sharh.entryById(id)).toBeNull();
 expect(global.query).not.toHaveBeenCalled();
});

test('loads the current hadith owner and bilingual body directly from SQL', async () => {
 global.query = jest.fn().mockResolvedValueOnce([{ id: 7, book_id: 100, hadith_id: 42 }]).mockResolvedValueOnce([book]).mockResolvedValueOnce([{ hId: 42, body: 'متن', body_en: 'Hadith', chain: 'السند', footnote_en: 'Footnote', num: '1', book_alias: 'bukhari' }]);
 const data = await Sharh.entryById(7);
 expect(data.owner).toMatchObject({ hId: 42, body: 'متن', body_en: 'Hadith' });
 expect(global.query.mock.calls[2][0]).toContain('WHERE hId=42');
 expect(data.owner.single).toBe(true);
 expect(data.owner.ar.chain).toBe('السند');
 expect(data.owner.en.footnote).toBe('Footnote');
 expect(data.canonical).toBe('/sharh/fath-al-bari/bukhari:1');
});

test('heading commentary loads its heading without requiring a hadith', async () => {
 global.query = jest.fn().mockResolvedValueOnce([{ id: 7, book_id: 100, toc_id: 55 }]).mockResolvedValueOnce([book]).mockResolvedValueOnce([{ id: 55, title: 'عنوان' }]);
 const data = await Sharh.entryById(7, 'heading');
 expect(data.owner.title).toBe('عنوان');
 expect(global.query.mock.calls[2][0]).toContain('WHERE t.id=55');
});

test('old ID-based hadith paths are not registered and do not resolve as references', async () => {
 expect(router.stack.some(layer => layer.route?.path === '/entry/:id')).toBe(false);
 expect(router.stack.some(layer => layer.route?.path === '/:alias/:id')).toBe(false);
 global.query = jest.fn();
 expect(await Sharh.entryByReference('fath-al-bari', '7')).toBeNull();
 expect(global.query).not.toHaveBeenCalled();
});

test('renders canonical pages and returns 404 for missing commentary', async () => {
 const data = { canonical: '/sharh/fath-al-bari/7', book, entry: { id: 7 } };
 jest.spyOn(Sharh, 'entryByReference').mockResolvedValueOnce(data).mockResolvedValueOnce(null);
 const req = { params: { alias: book.alias, reference: 'bukhari:1' }, path: '/fath-al-bari/7', route: { path: '/:alias/:reference' } };
 const res = response(), next = jest.fn();
 await handler('/:alias/:reference')(req, res, next);
 expect(res.render).toHaveBeenCalledWith('sharh_passage', expect.objectContaining(data));
 await handler('/:alias/:reference')(req, res, next);
 expect(res.sendStatus).toHaveBeenCalledWith(404);
});

test.each([false, true])('renders bilingual hadith above uncollapsed commentary (edit=%s)', editMode => {
 const filename = path.join(__dirname, '../views/sharh_passage.ejs');
 const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
  global: { settings: { site: {} } }, req: { admin: editMode, editMode },
  book, entry: { id: 7, text: 'شرح', text_en: 'Explanation' },
  owner: { book_alias: 'bukhari', num: 1, body: 'متن', body_en: 'Hadith' }, kind: 'hadith', canonical: '/sharh/fath-al-bari/7',
  utils: { markdownToHtml: s => `<p>${s}</p>`, urlFor: (_req, url) => url }, Tafsir: { renderCommentaryText: s => `<p>${s}</p>` }, include: (name, data) => name === 'sub-views/hadith.ejs' ? `<div class="shared-hadith">${data.i.body_en} ${data.i.body}</div>` : ''
 }, { filename });
 const $ = cheerio.load(html);
 expect($('main').attr('data-reader-infinite')).toBe('hadith-sharh');
 expect($('main').attr('data-reader-sharh-book')).toBe(book.alias);
 expect($('.hadith-detail-disclosure[open]')).toHaveLength(0);
 expect($('.shared-hadith').text()).toContain('Hadith');
 expect($('.shared-hadith').text()).toContain('متن');
 expect(html.indexOf('Referenced hadith')).toBeLessThan(html.indexOf('aria-label="Explanation"'));
 expect($('[data-hadith-sharh-collapsible]')).toHaveLength(0);
 expect($('.quran-tafsir-text')).toHaveLength(2);
 expect($('[data-prop="hdith_sharh.text_en"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-prop="hdith_sharh.revise"]')).toHaveLength(editMode ? 1 : 0);
});


test.each(['/:alias/:reference', '/:alias/heading/:id'])('old Sharh alias URLs return 404 for %s', async route => {
 jest.spyOn(Sharh, route.includes('heading') ? 'entryById' : 'entryByReference').mockResolvedValue({ canonical: '/sharh/new-alias/7', book: { alias: 'new-alias' } });
 const res = response(), next = jest.fn();
 await handler(route)({ params: { alias: 'old-alias', id: '7' }, path: '/old-alias/7', route: { path: route } }, res, next);
 expect(next.mock.calls[0][0].status).toBe(404);
 expect(res.redirect).not.toHaveBeenCalled();
 expect(res.render).not.toHaveBeenCalled();
});

test.each([1, 2, 3])('heading context retains bilingual titles and introductions at level %s', level => {
 const filename = path.join(__dirname, '../views/sub-views/sharh_context.ejs');
 const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
  page: { context: {} }, owner: { id: 55, level, book_alias: 'riyad', h1: .12, h2: 2, h3: 3, title: 'عنوان', title_en: 'Heading', intro: 'مقدمة', intro_en: 'Introduction' }, kind: 'heading',
  utils: require('../lib/Utils'), Tafsir: { renderCommentaryText: s => `<p>${s}</p>` }
 }, { filename });
 const $ = cheerio.load(html);
 expect($('heading [lang=en]').text()).toContain('Heading');
 expect($('heading [lang=ar]').text()).toContain('عنوان');
 expect($('.heading-intro [lang=en]').text()).toContain('Introduction');
 expect($('.heading-intro [lang=ar]').text()).toContain('مقدمة');
 expect($('heading a').first().attr('href')).toBe('/riyad/0.12' + (level >= 2 ? '/2' : '') + (level >= 3 ? '/3' : ''));
});

test('source context follows the explicit virtual-entry link instead of the original narration chapter', async () => {
 global.books = [{ id: 61, alias: 'riyad', shortName_en: 'Riyad' }];
 jest.spyOn(require('../lib/Model').Library, 'instance', 'get').mockReturnValue({ findBook: () => global.books[0] });
 global.query = jest.fn().mockResolvedValue([{ book_id: 61, book_alias: 'riyad', h1: .12, h1_id: 1514, h1_title_en: 'Later life', h1_title: 'أواخر العمر' }]);
 const context = await Sharh.readerContext({ owner: { id: 42, chapter: { title_en: 'Original chapter' } }, entry: { id: 88823 }, kind: 'hadith' });
 expect(global.query.mock.calls[0][0]).toContain('l.sharh_id=88823');
 expect(global.query.mock.calls[0][0]).toContain('hv.hadithId=42');
 expect(context.chapter.path).toBe('riyad/0.12');
 expect(context.chapter.title_en).toBe('Later life');
});

test('unlinked commentary keeps its original hadith context', async () => {
 global.query = jest.fn().mockResolvedValue([]);
 const owner = { id: 42, book: { alias: 'bukhari' }, chapter: { path: 'bukhari/64' }, section: { path: 'bukhari/64/50' } };
 const context = await Sharh.readerContext({ owner, entry: { id: 7 }, kind: 'hadith' });
 expect(context.chapter).toBe(owner.chapter);
 expect(context.section).toBe(owner.section);
});

test('reference pages retain every passage for the same book and hadith', async () => {
 global.query = jest.fn()
  .mockResolvedValueOnce([{ id: 7 }, { id: 8 }])
  .mockResolvedValueOnce([{ id: 7, book_id: 100, hadith_id: 42 }])
  .mockResolvedValueOnce([book])
  .mockResolvedValueOnce([{ hId: 42, book_alias: 'bukhari', num: '100' }])
  .mockResolvedValueOnce([{ id: 8, text: 'Second passage' }]);
 const data = await Sharh.entryByReference(book.alias, 'bukhari:100');
 expect(data.canonical).toBe('/sharh/fath-al-bari/bukhari:100');
 expect(data.entries.map(entry => entry.id)).toEqual([7, 8]);
 expect(global.query.mock.calls[0][0]).toContain("hb.alias='bukhari'");
 expect(global.query.mock.calls[0][0]).toContain("h.num='100'");
});

test.each([0, 1, 2])('carousel appears only for multiple available books (%s)', count => {
 const filename = path.join(__dirname, '../views/sharh_passage.ejs');
 const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
  global: { settings: { site: {} } }, req: {}, book, entry: { id: 7, text: 'شرح', text_en: 'Explanation' },
  owner: null, kind: 'hadith', canonical: '/sharh/fath-al-bari/bukhari:100',
  availableSharhs: Array.from({ length: count }, (_, index) => ({ ...book, id: 100 + index, url: `/sharh/book-${index}/bukhari:100` })),
  utils: { urlFor: (_req, url) => url }, Tafsir: { renderCommentaryText: s => s }, include: () => ''
 }, { filename });
 const $ = cheerio.load(html);
 expect($('[aria-label="Available explanations"]').length).toBe(count > 1 ? 1 : 0);
 expect($('.sharh-passage-entry .g-4 > [data-reader-language-column="english"]')).toHaveLength(1);
 expect($('.sharh-passage-entry .g-4 > [data-reader-language-column="arabic"]')).toHaveLength(1);
 if (count > 1) expect($('[aria-current="page"]').attr('href')).toBe('/sharh/book-0/bukhari:100');
});

test('indexed hadith context avoids the expensive view while preserving current SQL text', async () => {
 Index.docFromId.mockResolvedValue({ hId: 42, book_id: 1, tId: 55, level: 2, h1: 1, h1_id: 54, h2: 2, h2_id: 55, grade_id: 1, grader_id: 2, body: 'Stale', book_alias: 'bukhari', num: '100' });
 global.query = jest.fn().mockResolvedValueOnce([{ id: 7, book_id: 100, hadith_id: 42 }]).mockResolvedValueOnce([book])
  .mockResolvedValueOnce([{ id: 42, bookId: 1, tocId: 55, gradeId: 1, graderId: 2, book_alias: 'bukhari', num: '100', body: 'Current Arabic', body_en: 'Current English' }]);
 const data = await Sharh.entryById(7);
 expect(data.owner.ar.body).toBe('Current Arabic');
 expect(data.owner.en.body).toBe('Current English');
 expect(data.owner.section.path).toBe('bukhari/1/2');
 expect(global.query.mock.calls.some(([sql]) => sql.includes('FROM v_hadiths'))).toBe(false);
});

test('stale indexed hadith placement falls back to the current SQL reader view', async () => {
 Index.docFromId.mockResolvedValue({ hId: 42, book_id: 1, tId: 54, grade_id: 1, grader_id: 2 });
 global.query = jest.fn().mockResolvedValueOnce([{ id: 7, book_id: 100, hadith_id: 42 }]).mockResolvedValueOnce([book])
  .mockResolvedValueOnce([{ id: 42, bookId: 1, tocId: 55, gradeId: 1, graderId: 2 }])
  .mockResolvedValueOnce([{ hId: 42, book_alias: 'bukhari', num: '100', body: 'Current' }]);
 expect((await Sharh.entryById(7)).owner.ar.body).toBe('Current');
 expect(global.query.mock.calls[3][0]).toContain('FROM v_hadiths');
});

test('indexed source heading uses its live introduction without querying the slow TOC view', async () => {
 jest.spyOn(require('../lib/Model').Library, 'instance', 'get').mockReturnValue({ findBook: () => ({ alias: 'riyad' }) });
 Index.docFromId.mockResolvedValue({ tId: 55, book_id: 61, book_alias: 'riyad', level: 1, h1: .12, h1_id: 55, h1_intro: 'Stale' });
 global.query = jest.fn().mockResolvedValue([{ id: 55, bookId: 61, book_alias: 'riyad', level: 1, h1: .12, title: 'Heading', intro: 'Current intro' }]);
 const context = await Sharh.readerContext({ owner: { id: 42 }, entry: { id: 7 }, kind: 'hadith' });
 expect(context.chapter.intro).toBe('Current intro');
 expect(context.chapter.title).toBe('Heading');
 expect(global.query).toHaveBeenCalledTimes(1);
 expect(global.query.mock.calls[0][0]).not.toContain('v_toc');
});

test('ES outages still render the current SQL-backed hadith', async () => {
 Index.docFromId.mockRejectedValue(new Error('ES unavailable'));
 global.query = jest.fn().mockResolvedValueOnce([{ id: 7, book_id: 100, hadith_id: 42 }]).mockResolvedValueOnce([book])
  .mockResolvedValueOnce([{ hId: 42, book_alias: 'bukhari', num: '100', body: 'Fallback text' }]);
 expect((await Sharh.entryById(7)).owner.ar.body).toBe('Fallback text');
});

test.each([
 ['hadith', { num: '1', book: { shortName_en: 'Bukhari' } }, 'Bukhari 1 | Fath al-Bari'],
 ['heading', { level: 2, h1: 2, h2: 2, title_en: 'Īmān (Faith / Belief)' }, 'Bukhari §2.2 | Īmān (Faith / Belief) | Fath al-Bari'],
 ['heading', { level: 1, h1: 2, title_en: 'Īmān (Faith / Belief)' }, 'Bukhari §2 | Īmān (Faith / Belief) | Fath al-Bari']
])('native title identifies the source reference and sharh for %s', (kind, owner, expected) => {
 const filename = path.join(__dirname, '../views/sharh_passage.ejs');
 let pageTitle;
 ejs.render(fs.readFileSync(filename, 'utf8'), {
  global: { settings: { site: {} } }, req: {}, book, owner, kind,
  readerContext: { book: { shortName_en: kind === 'hadith' ? 'Riyad' : 'Bukhari' } },
  entry: { id: 7, text: 'شرح' }, canonical: '/sharh/example',
  utils: { formatHadithHeadingNumber: require('../lib/Utils').formatHadithHeadingNumber, urlFor: (_req, url) => url },
  Tafsir: { renderCommentaryText: s => s },
  include: (name, data) => { if (name === 'sub-views/head.ejs') pageTitle = data.page.title_en; return ''; }
 }, { filename });
 expect(pageTitle).toBe(expected);
});

test('same-sharh navigation uses available narrations in source order', async () => {
 global.query = jest.fn().mockResolvedValue([
  { id: 10, reference: 'bukhari:2' },
  { id: 20, reference: 'muslim:10a' },
  { id: 30, reference: 'bukhari:9' }
 ]);
 expect(await Sharh.readerNavigation({ book, owner: { id: 20 }, kind: 'hadith' })).toEqual({
  prev: '/sharh/fath-al-bari/bukhari:2', prevTitle: 'Previous: bukhari:2',
  next: '/sharh/fath-al-bari/bukhari:9', nextTitle: 'Next: bukhari:9'
 });
 expect(global.query.mock.calls[0][0]).toContain('WHERE sb.id=100');
 expect(global.query.mock.calls[0][0]).toContain('COALESCE(hv.num0, h.num0)');
});

test.each([10, 30])('same-sharh navigation stops at collection boundary %s', async id => {
 global.query = jest.fn().mockResolvedValue([{ id: 10, reference: 'bukhari:2' }, { id: 30, reference: 'bukhari:9' }]);
 const navigation = await Sharh.readerNavigation({ book, owner: { id }, kind: 'hadith' });
 expect(navigation[id === 10 ? 'prev' : 'next']).toBeUndefined();
 expect(navigation[id === 10 ? 'next' : 'prev']).toContain('/sharh/fath-al-bari/');
});

test('reader sequence connects introduction commentary to hadith commentary with separate identities', async () => {
 global.query = jest.fn().mockResolvedValue([
  { id: 10, kind: 'heading', reference: '10' },
  { id: 10, kind: 'hadith', reference: 'bukhari:1' }
 ]);
 const intro = await Sharh.readerNavigation({ book, owner: { id: 55 }, entry: { id: 10 }, kind: 'heading' });
 expect(intro.prev).toBeUndefined();
 expect(intro.next).toBe('/sharh/fath-al-bari/bukhari:1');
 const hadith = await Sharh.readerNavigation({ book, owner: { id: 10 }, kind: 'hadith' });
 expect(hadith.prev).toBe('/sharh/fath-al-bari/heading/10');
 expect(hadith.next).toBeUndefined();
});
