'use strict';
const ejs = require('ejs');
const Utils = require('../lib/Utils');
const Sharh = require('../lib/Sharh');
const router = require('../routes/sharh');
const handle = kind => router.stack.find(l => l.route?.path === (kind === 'heading' ? '/:alias/heading/:id' : '/:alias/:reference')).route.stack[0].handle;
const data = { book: { alias: 'test-sharh' }, owner: { book_alias: 'bukhari', num: '1' }, entry: { id: 1 } };
let req, res;
beforeEach(() => {
 req = { params: { alias: 'test-sharh', reference: 'bukhari:1', id: '1' }, originalUrl: '/sharh/test-sharh/bukhari:1', query: {}, route: { path: '/:alias/:reference' } };
 res = { locals: {}, app: { locals: {} }, render: jest.fn(), sendStatus: jest.fn() };
 jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
 jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
 jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
 jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
 jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue();
 jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue();
 jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>public</html>');
 jest.spyOn(Sharh, 'entryByReference').mockResolvedValue(data);
 jest.spyOn(Sharh, 'entryById').mockResolvedValue(data);
 jest.spyOn(Sharh, 'readerContext').mockResolvedValue({ book: { alias: 'riyad' } });
 jest.spyOn(Sharh, 'availableBooks').mockResolvedValue([{ alias: 'other-sharh' }]);
});
afterEach(() => jest.restoreAllMocks());
test('cache hit skips SQL and reader construction', async () => {
 Utils.cachedTextPathForRead.mockReturnValue('cached.gz');
 await handle()(req, res, jest.fn());
 expect(Sharh.entryByReference).not.toHaveBeenCalled();
 expect(Sharh.readerContext).not.toHaveBeenCalled();
 expect(Utils.sendCachedHtml.mock.calls[0][2]).toContain(`/sharh${Utils.ASSET_SUFFIX_SLUG}/test-sharh/`);
});
test.each(['hadith', 'heading'])('indexes %s pages under their book with edit dependencies', async kind => {
 req.route.path = kind === 'heading' ? '/:alias/heading/:id' : '/:alias/:reference';
 await handle(kind)(req, res, jest.fn());
 expect(ejs.renderFile.mock.calls[0][1].noadmin).toBe(true);
 expect(Utils.indexCachedItem).toHaveBeenCalledWith(expect.arrayContaining(['test-sharh', 'book:test-sharh', 'bukhari', 'book:bukhari', 'riyad', 'other-sharh']), expect.stringContaining(`/sharh${Utils.ASSET_SUFFIX_SLUG}/test-sharh/`));
 if (kind === 'hadith') expect(Utils.indexCachedItem.mock.calls[0][0]).toContain('bukhari:1');
});
test.each(['admin', 'disabled'])('%s bypasses cache reads and writes', async mode => {
 if (mode === 'admin') Object.assign(req, { admin: true, editMode: true });
 else Utils.diskCacheEnabled.mockReturnValue(false);
 await handle()(req, res, jest.fn());
 expect(Utils.sendCachedHtml).not.toHaveBeenCalled();
 expect(Utils.writeCachedHtml).not.toHaveBeenCalled();
 expect(res.render).toHaveBeenCalled();
});
test('flush invalidates and rebuilds instead of serving the old page', async () => {
 req.query.flush = '1';
 Utils.cachedTextPathForRead.mockReturnValue('cached.gz');
 await handle()(req, res, jest.fn());
 expect(Utils.flushCachedFile).toHaveBeenCalled();
 expect(Sharh.entryByReference).toHaveBeenCalled();
 expect(Utils.writeCachedHtml).toHaveBeenCalled();
});
test('missing pages are not cached', async () => {
 Sharh.entryByReference.mockResolvedValue(null);
 await handle()(req, res, jest.fn());
 expect(res.sendStatus).toHaveBeenCalledWith(404);
 expect(Utils.writeCachedHtml).not.toHaveBeenCalled();
});
