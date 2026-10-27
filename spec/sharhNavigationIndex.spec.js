'use strict';
const axios = require('axios');
const Navigation = require('../lib/SharhNavigationIndex');
const Sharh = require('../lib/Sharh');
const Utils = require('../lib/Utils');
const book = { id: 100400, alias: 'malik-istidhkar' };
const rows = [
	{ id: 7, kind: 'heading', reference: '7', toc_id: 55, physical_book_id: 3, source_ids: '3' },
	{ id: 7, kind: 'hadith', reference: 'malik:29-38', physical_book_id: 3, source_ids: '3,99' },
	{ id: 8, kind: 'hadith', reference: 'muslim:10a', physical_book_id: 2, source_ids: '99' }
];
const missing = () => Object.assign(new Error('missing'), { response: { status: 404 } });

beforeEach(() => {
	global.settings = { search: { domain: 'http://es.test' } };
	global.query = jest.fn().mockResolvedValue([book]);
	jest.spyOn(axios, 'get').mockRejectedValue(missing());
	jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });
	jest.spyOn(axios, 'post').mockResolvedValue({ data: { hits: { hits: [] } } });
	jest.spyOn(Sharh, 'buildReaderSequence').mockResolvedValue(rows);
	jest.spyOn(Sharh, 'invalidateReaderSequence').mockResolvedValue();
	jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
});
afterEach(() => { jest.restoreAllMocks(); delete global.query; delete global.settings; });

test('stores complete ordered navigation with distinct heading/hadith identities and all source dependencies', () => {
	const doc = Navigation.document(book, rows);
	expect(Navigation.valid(doc, book)).toBe(true);
	expect(doc.rows).toEqual(rows);
	expect(doc.source_book_ids).toEqual([3, 99, 2]);
	expect(doc.hadith_ids).toEqual([7, 8]);
	expect(doc.heading_ids).toEqual([55]);
});

test('reads a complete snapshot without SQL, including an intentionally empty book', async () => {
	axios.get.mockResolvedValueOnce({ data: { _source: Navigation.document(book, rows) } });
	expect(await Navigation.read(book)).toEqual(rows);
	axios.get.mockResolvedValueOnce({ data: { _source: Navigation.document(book, []) } });
	expect(await Navigation.read(book)).toEqual([]);
	expect(global.query).not.toHaveBeenCalled();
});

test.each([
	{ version: 0 }, { bookId: 999 }, { alias: 'old-alias' },
	{ rows: [{ id: 7, kind: 'heading', reference: '8' }] },
	{ rows: [rows[1], rows[1]] }, { rows: [{ id: 7, kind: 'hadith', reference: '/bad' }] }
])('rejects incompatible or malformed snapshots: %j', async change => {
	axios.get.mockResolvedValue({ data: { _source: { ...Navigation.document(book, rows), ...change } } });
	expect(await Navigation.read(book)).toBeNull();
});

test('missing or unavailable ES permits the existing SQL fallback', async () => {
	expect(await Navigation.read(book)).toBeNull();
	axios.get.mockRejectedValueOnce(new Error('offline'));
	expect(await Navigation.read(book)).toBeNull();
});

test('publishes atomically before invalidating sequence and neighbor HTML', async () => {
	await Navigation.refreshBook(book);
	expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/_doc/100400?refresh=true&op_type=create'), Navigation.document(book, rows), expect.any(Object));
	expect(Sharh.invalidateReaderSequence).toHaveBeenCalledWith(book);
	expect(Utils.flushCacheContaining).toHaveBeenCalledWith(book.alias);
	expect(axios.put.mock.invocationCallOrder[0]).toBeLessThan(Sharh.invalidateReaderSequence.mock.invocationCallOrder[0]);
});

test('unchanged navigation avoids writes and cache flushes on text-only indexing', async () => {
	axios.get.mockResolvedValue({ data: { _source: Navigation.document(book, rows), _seq_no: 4, _primary_term: 1 } });
	await Navigation.refreshBook(book);
	expect(axios.put).not.toHaveBeenCalled();
	expect(Utils.flushCacheContaining).not.toHaveBeenCalled();
});

test('a concurrent update retries SQL with the latest ES revision', async () => {
	axios.get.mockResolvedValue({ data: { _source: Navigation.document(book, []), _seq_no: 5, _primary_term: 1 } });
	axios.put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409 } }));
	await Navigation.refreshBook(book);
	expect(Sharh.buildReaderSequence).toHaveBeenCalledTimes(2);
	expect(axios.put).toHaveBeenLastCalledWith(expect.stringContaining('if_seq_no=5&if_primary_term=1'), expect.any(Object), expect.any(Object));
});

test('failed publication propagates and does not claim cache invalidation succeeded', async () => {
	axios.put.mockRejectedValue(new Error('offline'));
	await expect(Navigation.refreshBook(book)).rejects.toThrow('offline');
	expect(Sharh.invalidateReaderSequence).not.toHaveBeenCalled();
});

test('refreshes both previous and current books when a hadith changes book or loses its last passage', async () => {
	axios.post.mockResolvedValue({ data: { hits: { hits: [{ _source: { bookId: 100399 } }] } } });
	global.query.mockResolvedValue([{ id: 100399, alias: 'old' }, book]);
	await Navigation.syncHadiths([7, 7], [book.id]);
	expect(global.query).toHaveBeenCalledWith(expect.stringContaining('id IN (100399,100400)'));
	expect(Sharh.buildReaderSequence).toHaveBeenCalledTimes(2);
});

test('heading deletion finds its previous book even when current SQL ownership is empty', async () => {
	axios.post.mockResolvedValue({ data: { hits: { hits: [{ _source: { bookId: book.id } }] } } });
	global.query.mockResolvedValueOnce([]).mockResolvedValueOnce([book]);
	await Navigation.syncHeadings([55]);
	expect(axios.post.mock.calls[0][1].query.bool.filter[0]).toEqual({ terms: { heading_ids: [55] } });
	expect(Sharh.buildReaderSequence).toHaveBeenCalledWith(book);
});

test('source refresh includes old dependencies after virtual ownership changes', async () => {
	axios.post.mockResolvedValue({ data: { hits: { hits: [{ _source: { bookId: book.id } }] } } });
	global.query.mockResolvedValueOnce([]).mockResolvedValueOnce([book]);
	await Navigation.syncSourceBooks([99]);
	expect(axios.post.mock.calls[0][1].query.bool.filter[0]).toEqual({ terms: { source_book_ids: [99] } });
	expect(Sharh.buildReaderSequence).toHaveBeenCalledWith(book);
});

test('partial dependency searches fail instead of silently leaving old books stale', async () => {
	axios.post.mockResolvedValue({ data: { timed_out: true, hits: { hits: [] } } });
	await expect(Navigation.syncHadiths([7], [])).rejects.toThrow('Incomplete');
	expect(Sharh.buildReaderSequence).not.toHaveBeenCalled();
});
