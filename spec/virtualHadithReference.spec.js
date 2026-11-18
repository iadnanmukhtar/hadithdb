'use strict';
const { getReference } = require('../lib/VirtualHadithReference');
const { Item } = require('../lib/Model');
const fs = require('fs');
const vm = require('vm');
const book = { id: 61, alias: 'riyad', virtual: 1 };
const originalQuery = global.query;
afterEach(() => { global.query = originalQuery; });

const row = { hId: 20, book_id: 61, book_virtual: 1, book_alias: 'riyad', num: '100', hId_ref: 999, book_alias_ref: 'muslim', num_ref: '2664', prev_ref: 'muslim:2663', next_ref: 'muslim:2665' };
const sequence = [{ id: 30, num: '99' }, { id: 20, num: '100' }, { id: 10, num: '101' }];
test.each([0, 1, 2])('uses virtual order and respects collection boundary at position %i', async position => {
  global.query = jest.fn().mockResolvedValueOnce([{ id: sequence[position].id }])
    .mockResolvedValueOnce([{ ...row, hId: sequence[position].id, num: sequence[position].num }])
    .mockResolvedValueOnce(sequence);
  const [result] = await getReference(book, sequence[position].num);
  expect(result.prev_ref).toBe(position > 0 ? `riyad:${sequence[position - 1].num}` : null);
  expect(result.next_ref).toBe(position < 2 ? `riyad:${sequence[position + 1].num}` : null);
  const item = new Item(result);
  expect(item.actual.id).toBe(999);
  expect(item.en.actual.num).toBe('2664');
  expect(item.en.num).toBe(sequence[position].num);
});

test('recovers a linked reference from the live view if its snapshot is missing', async () => {
  global.query = jest.fn().mockResolvedValueOnce([{ id: 20 }]).mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ ...row }]).mockResolvedValueOnce(sequence);
  expect((await getReference(book, '100'))[0].ref).toBe('riyad:100');
  expect(global.query.mock.calls[2][0]).toContain('FROM v_hadiths_virtual WHERE hId=20');
});

test('missing and broken references do not fall through to physical hadiths', async () => {
  global.query = jest.fn().mockResolvedValue([]);
  expect(await getReference(book, '99999')).toEqual([]);
  global.query = jest.fn().mockResolvedValueOnce([{ id: 20 }]).mockResolvedValue([]);
  await expect(getReference(book, '100')).rejects.toMatchObject({ status: 503 });
});

test('reference route renders the virtual item without redirecting or searching the physical index', async () => {
  const source = fs.readFileSync(require.resolve('../routes/search'), 'utf8');
  const start = source.indexOf("router.get('/:bookAlias\\::num',");
  const end = source.indexOf('\nasync function renderQuranAyahPassage', start);
  let handler;
  const indexLookup = jest.fn();
  const scope = vm.createContext({
    router: { get: (_, callback) => { handler = callback; } },
    require: name => { expect(name).toBe('../lib/VirtualHadithReference'); return { getReference }; },
    Arabic: require('../lib/Arabic'), Books: require('../lib/Books'),
    visibleBookByAlias: () => ({ ...book, properties: { reader: { referenceView: 'section' } } }),
    SirahReader: { sourceReference: async () => null },
    Index: { docsFromKeyValue: indexLookup },
    Item: class { constructor(value) { Object.assign(this, value); this.actual = { id: value.hId_ref }; this.book = book; } },
    HdithMetadata: { forHadith: async () => ({}), withPrimaryGrade: () => [], attachClassifications: async () => {} },
    Hadith: { a_dbGetSimilarCandidates: async () => [] }, addVirtualReferences: async () => {}, global: { books: [book] }
  });
  vm.runInContext(source.slice(start, end), scope);
  global.query = jest.fn().mockResolvedValueOnce([{ id: 20 }]).mockResolvedValueOnce([{ ...row }]).mockResolvedValueOnce(sequence);
  const res = { locals: {}, render: jest.fn(), redirect: jest.fn() };
  await handler({ params: { bookAlias: 'riyad', num: '100' }, query: {} }, res, jest.fn());
  expect(res.redirect).not.toHaveBeenCalled();
  expect(indexLookup).not.toHaveBeenCalled();
  expect(res.render).toHaveBeenCalledWith('search', expect.objectContaining({ results: [expect.objectContaining({ single: true, ref: 'riyad:100', prev_ref: 'riyad:99', next_ref: 'riyad:101', actual: { id: 999 } })] }));
});

test.each(['en', 'ar'])('renders both virtual and source references in %s', lang => {
  const ejs = require('ejs');
  const template = fs.readFileSync('views/sub-views/hadith_item.ejs', 'utf8');
  const start = template.indexOf('<%# Virtual Num %>');
  const end = template.indexOf('</a></b>', start) + '</a></b>'.length;
  const item = new Item({ ...row, single: true, book_shortName: 'رياض', book_shortName_ref: 'مسلم' });
  const html = ejs.render(template.slice(start, end), {
    i: item, lang, langData: item[lang], langActual: item[lang].actual,
    site: { editMode: false }, itemHref: '/muslim:2664',
    itemBookShortName: item[lang].actual.book_shortName,
    itemLinkTitleSource: '', linkTitle: value => value
  });
  expect(html).toContain(lang === 'en' ? '(riyad:' : '(رياض:');
  expect(html).toContain(lang === 'en' ? '>100</span>' : '>١٠٠</span>');
  expect(html).toContain(lang === 'en' ? 'muslim:2664' : 'مسلم:٢٦٦٤');
});

test.each([true, false])('detail canonical uses the original hadith (virtual=%s), preserving navigation', virtual => {
  const ejs = require('ejs');
  const Utils = require('../lib/Utils');
  const source = fs.readFileSync('views/search.ejs', 'utf8');
  const template = source.slice(0, source.indexOf("<%- include('sub-views/head.ejs'"));
  const item = virtual ? new Item({ ...row, single: true, ref_ref: 'muslim:2664', prev_ref: 'riyad:99', next_ref: 'riyad:101' })
    : new Item({ hId: 999, book_alias: 'muslim', num: '2664', single: true, prev_ref: 'muslim:2663', next_ref: 'muslim:2665' });
  const itemBook = { alias: virtual ? 'riyad' : 'muslim', shortName_en: 'Collection' };
  const page = JSON.parse(ejs.render(template + '<%- JSON.stringify(page) %>', {
    global: { settings: { site: {} } }, q: '', req: {}, results: [item], book: itemBook, utils: Utils
  }).replace(/^[\s\S]*?<head>\s*/, '').trim());
  expect(page.canonical).toBe('/muslim:2664');
  expect(page.prev).toBe(virtual ? '/riyad:99' : '/muslim:2663');
  expect(page.next).toBe(virtual ? '/riyad:101' : '/muslim:2665');
});
