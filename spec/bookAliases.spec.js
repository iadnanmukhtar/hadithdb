'use strict';
const Aliases = require('../lib/BookAliases');
const axios = require('axios');
const Utils = require('../lib/Utils');
const Hadith = require('../lib/Hadith');
const RuntimeRefresh = require('../lib/RuntimeRefresh');
const Books = require('../lib/Books');
const base = { id: 12, type: 'hadith', alias: 'old-book', source: 'local', properties: { rendering: { footnotes: 'sm' } } };
afterEach(() => { jest.restoreAllMocks(); delete global.query; delete global.dbPool; delete global.books; });

test.each(['hadith', 'sharh', 'tafsir', 'trans', 'sirah'])('accepts main alias changes for %s books', type => {
 expect(() => Aliases.validate({ ...base, type }, 'new_book', [base])).not.toThrow();
});
test.each(['', 'TwoWords', '../admin', 'a/b', '1book', 'admin', 'sharh'])('rejects invalid or reserved alias %s', alias => {
 expect(() => Aliases.validate(base, alias, [base])).toThrow();
});
test('keeps Quran application identity fixed', () => {
 expect(() => Aliases.validate({ ...base, type: 'quran', alias: 'quran' }, 'new-quran', [])).toThrow('Quran alias is fixed');
});
test('reserves previous aliases and normalized names across all book types', () => {
 const other = { id: 15, alias: 'other', type: 'sharh', properties: { url_aliases: ['prior-name'] } };
 expect(() => Aliases.validate(base, 'prior_name', [base, other])).toThrow('already used');
 expect(() => Aliases.validate({ ...base, type: 'tafsir' }, 'ar-tafsir-other', [base, other])).toThrow('already used');
});
test.each([
 ['hadith', '/old-book:1', '/new-book:1'],
 ['sirah', '/old-book/2/3', '/new-book/2/3'],
 ['hadith', '/old-book.epub', '/new-book.epub'],
 ['tafsir', '/quran/tafsir/old-book/quran:1:1', '/quran/tafsir/new-book/quran:1:1'],
 ['trans', '/quran/old-book/1', '/quran/new-book/1']
])('redirects old %s URLs without changing their references', (type, old, expected) => {
 expect(Aliases.canonicalPath(old, [{ ...base, type, alias: 'new-book', properties: { url_aliases: ['old-book'] } }])).toBe(expected);
});
test('does not rewrite another book sharing the old prefix', () => {
 expect(Aliases.canonicalPath('/old-book-extra:1', [{ ...base, alias: 'new-book', properties: { url_aliases: ['old-book'] } }])).toBe('');
});
test('redirect middleware preserves query and never redirects a write', () => {
 global.books = [{ ...base, alias: 'new-book', properties: { url_aliases: ['old-book'] } }];
 const res = { redirect: jest.fn() }, next = jest.fn();
 Aliases.middleware({ method: 'GET', path: '/old-book:1', originalUrl: '/old-book:1?flush=1' }, res, next);
 expect(res.redirect).toHaveBeenCalledWith(301, '/new-book:1?flush=1');
 Aliases.middleware({ method: 'POST', path: '/old-book:1' }, res, next);
 expect(next).toHaveBeenCalledTimes(1);
});
function database(rows) {
 const query = jest.fn((sql, params, callback) => {
  if (typeof params === 'function') callback = params;
  callback(null, sql.startsWith('SELECT *') ? rows : { affectedRows: 1 });
 });
 const connection = { query, release: jest.fn() };
 global.dbPool = { getConnection: callback => callback(null, connection) };
 return connection;
}
test('saves transactionally, preserves metadata and pins a remote source identity', async () => {
 const connection = database([{ ...base, type: 'tafsir', source: 'tafsir.app' }]);
 const result = await Aliases.save(12, 'new-book');
 expect(result.book).toMatchObject({ id: 12, alias: 'new-book', properties: { rendering: { footnotes: 'sm' }, source_alias: 'old-book', url_aliases: ['old-book'], alias_refresh_pending: true } });
 expect(connection.query.mock.calls.find(call => call[0].startsWith('UPDATE books'))[1]).toEqual(['new-book', JSON.stringify(result.book.properties), 12]);
 expect(connection.query).toHaveBeenCalledWith('COMMIT', expect.any(Function));
 expect(connection.release).toHaveBeenCalled();
});
test('collision rolls back before changing any book', async () => {
 const connection = database([base, { id: 13, alias: 'taken' }]);
 await expect(Aliases.save(12, 'taken')).rejects.toThrow('already used');
 expect(connection.query.mock.calls.some(call => call[0].startsWith('UPDATE'))).toBe(false);
 expect(connection.query).toHaveBeenCalledWith('ROLLBACK', expect.any(Function));
});
test('renaming back removes the active alias from redirect history', async () => {
 database([{ ...base, alias: 'new-book', properties: { url_aliases: ['old-book'], source_alias: 'provider-book' } }]);
 const result = await Aliases.save(12, 'old-book');
 expect(result.book.properties.url_aliases).toEqual(['new-book']);
 expect(result.book.properties.source_alias).toBe('provider-book');
});
test('refresh updates search, virtual snapshots, cache paths and worker state before clearing pending status', async () => {
 const book = { ...base, alias: 'new-book', properties: { url_aliases: ['old-book'] } };
 global.settings = { search: { domain: 'http://search.test' } };
 global.books = [book, { id: 44, alias: 'virtual-book' }];
 global.query = jest.fn(async sql => sql.startsWith('SELECT DISTINCT hv.bookId') ? [{ bookId: 44 }] : []);
 jest.spyOn(axios, 'post').mockResolvedValue({ data: { version_conflicts: 0, failures: [] } });
 jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
 jest.spyOn(Utils, 'flushBookDiskCache').mockResolvedValue();
 jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue();
 jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue('/tmp/catalog.html');
 jest.spyOn(Hadith, 'a_reinit').mockResolvedValue();
 jest.spyOn(RuntimeRefresh, 'publish').mockResolvedValue();
 jest.spyOn(require('../lib/SharhNavigationIndex'), 'syncSourceBooks').mockResolvedValue();
 await Aliases.refresh(book);
 expect(require('../lib/SharhNavigationIndex').syncSourceBooks).toHaveBeenCalledWith([book.id]);
 expect(global.query).toHaveBeenCalledWith('CALL refresh_v_hadiths_virtual_snapshot(44)');
 expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('_update_by_query'), expect.objectContaining({ script: expect.objectContaining({ params: expect.objectContaining({ old: 'old-book', alias: 'new-book' }) }) }), expect.any(Object));
 for (const alias of ['old-book', 'new-book', 'virtual-book']) expect(Utils.flushBookDiskCache).toHaveBeenCalledWith(alias, { strict: true });
 expect(Hadith.a_reinit).toHaveBeenCalled();
 expect(RuntimeRefresh.publish).toHaveBeenCalled();
 expect(global.query.mock.calls.at(-1)[0]).toContain('JSON_REMOVE');
});
test('partial search failures remain retryable and never clear pending status', async () => {
 global.settings = { search: { domain: 'http://search.test' } };
 global.query = jest.fn().mockResolvedValue([]);
 jest.spyOn(axios, 'post').mockResolvedValue({ data: { version_conflicts: 1 } });
 await expect(Aliases.refresh({ ...base, properties: { url_aliases: ['older'] } })).rejects.toThrow('incomplete');
 expect(global.query.mock.calls.some(call => call[0].includes('JSON_REMOVE'))).toBe(false);
});

test('does not redirect previous Sharh aliases', () => {
 expect(Aliases.canonicalPath('/sharh/old-book/8', [{ ...base, type: 'sharh', alias: 'new-book', properties: { url_aliases: ['old-book'] } }])).toBe('');
});
