'use strict';
const Refresh = require('../lib/HadithPairRefresh');
const Pairs = require('../lib/HadithBilingualPairs');
const Metadata = require('../lib/HdithMetadata');
const NarratorIndex = require('../lib/HadithNarratorIndex');
const Books = require('../lib/Books');
const Utils = require('../lib/Utils');
const Hadith = require('../lib/Hadith');
const RuntimeRefresh = require('../lib/RuntimeRefresh');
beforeEach(() => {
  global.query = jest.fn(async sql => sql.startsWith('SELECT') ? [{ id: 9, alias: 'mishkat' }] : []);
  for (const [object, method] of [[Pairs,'rebuildNarratorCatalog'],[Metadata,'invalidatePrimaryNarratorSuggestionCache'],[Metadata,'invalidateSharhTitleSuggestionCache'],[NarratorIndex,'reindex'],[Books,'touchBookContentLastmodByAlias'],[Utils,'flushCacheContaining'],[Utils,'flushBookDiskCache'],[Hadith,'a_reinit'],[RuntimeRefresh,'publish']])
    jest.spyOn(object, method).mockResolvedValue();
});
afterEach(() => { jest.restoreAllMocks(); delete global.query; });
test('refreshes physical and virtual readers, suggestions, worker caches and search after a merge', async () => {
  await Refresh.refresh({ type: 'narrator', affected_hadith_ids: [7], affected_book_aliases: ['shuab'] });
  expect(global.query).toHaveBeenCalledWith('CALL refresh_v_hadiths_virtual_snapshot(9)');
  for (const alias of ['shuab','mishkat']) {
    expect(Books.touchBookContentLastmodByAlias).toHaveBeenCalledWith(alias);
    expect(Utils.flushBookDiskCache).toHaveBeenCalledWith(alias, { strict: true });
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith(alias);
  }
  expect(Pairs.rebuildNarratorCatalog).toHaveBeenCalled();
  expect(Hadith.a_reinit).toHaveBeenCalled();
  expect(RuntimeRefresh.publish).toHaveBeenCalled();
  expect(NarratorIndex.reindex).toHaveBeenCalledWith([7]);
});
test('does not report success when search refresh fails', async () => {
  NarratorIndex.reindex.mockRejectedValue(new Error('offline'));
  await expect(Refresh.refresh({ type: 'grader', affected_hadith_ids: [7], affected_book_aliases: ['shuab'] })).rejects.toThrow('offline');
  expect(Pairs.rebuildNarratorCatalog).not.toHaveBeenCalled();
});
