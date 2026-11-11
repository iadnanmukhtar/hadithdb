'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../routes/update'), 'utf8');

function fixture() {
  const events = [];
  const step = name => jest.fn(async () => { events.push(name); });
  const context = {
    hadithSearchRowById: jest.fn().mockResolvedValue({ book_id: 1, book_alias: 'bukhari', num: 1 }),
    Books: { touchBookContentLastmodById: step('lastmod') },
    Index: { update: step('index') }, Item: { INDEX: 'hadiths' },
    VirtualHadithSnapshot: { refreshHadith: step('snapshot') },
    Utils: { flushCacheContaining: step('flush') },
    RuntimeRefresh: { publish: step('publish') }
  };
  const start = source.indexOf('async function runHadithPostUpdateTasks(');
  const end = source.indexOf('\nasync function hadithSearchRowById', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.save = runHadithPostUpdateTasks;', context);
  return { context, events };
}

test('a save refreshes search and virtual snapshots before invalidating pages and both workers', async () => {
  const { context: c, events } = fixture();
  await c.save(123);
  expect(events).toEqual(['lastmod', 'index', 'snapshot', 'flush', 'publish']);
  expect(c.Index.update).toHaveBeenCalledWith('hadiths', expect.anything(), { force: true, refresh: true });
  expect(c.VirtualHadithSnapshot.refreshHadith).toHaveBeenCalledWith(123);
  expect(c.RuntimeRefresh.publish).toHaveBeenCalledWith({ invalidateLocal: true });
});

test('a failed index update is surfaced and cannot repopulate invalidated pages from stale search', async () => {
  const { context: c } = fixture();
  c.Index.update.mockRejectedValue(new Error('index unavailable'));
  await expect(c.save(123)).rejects.toThrow('index unavailable');
  expect(c.Utils.flushCacheContaining).not.toHaveBeenCalled();
  expect(c.RuntimeRefresh.publish).not.toHaveBeenCalled();
});
