'use strict';

const searchRouter = require('../routes/search');
const Hadith = require('../lib/Hadith');
const RuntimeRefresh = require('../lib/RuntimeRefresh');
const Utils = require('../lib/Utils');

function reinitHandler() {
	const layer = searchRouter.stack.find(item => item.route && item.route.path === '/reinit');
	return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('/reinit', () => {
	let originalBooks;

	beforeEach(() => {
		originalBooks = global.books;
		global.books = [
			{ alias: 'quran', type: 'quran' },
			{ alias: 'shamail', type: 'hadith' },
			{ alias: 'adab' },
			{ alias: 'rida', type: 'tafsir' },
			{ alias: 'en-sahih', type: 'trans' }
		];
		jest.spyOn(Hadith, 'a_reinit').mockResolvedValue();
		jest.spyOn(RuntimeRefresh, 'publish').mockResolvedValue('test-generation');
		jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue(true);
		jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
	});

	afterEach(() => {
		global.books = originalBooks;
		jest.restoreAllMocks();
	});

	test('refreshes the current worker, all Hadith TOC caches, and other workers', async () => {
		const res = {
			setHeader: jest.fn(),
			write: jest.fn(),
			end: jest.fn()
		};

		await reinitHandler()({}, res, jest.fn());

		expect(Hadith.a_reinit).toHaveBeenCalledTimes(1);
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith('shamail');
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith('book:shamail');
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith('adab');
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith('book:adab');
		expect(Utils.flushCacheContaining).not.toHaveBeenCalledWith('rida');
		expect(Utils.flushCacheContaining).not.toHaveBeenCalledWith('en-sahih');
		expect(RuntimeRefresh.publish).toHaveBeenCalledTimes(1);
		expect(RuntimeRefresh.publish.mock.invocationCallOrder[0])
			.toBeLessThan(Utils.flushCacheContaining.mock.invocationCallOrder[0]);
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate');
		expect(res.write).toHaveBeenCalledWith('Done');
		expect(res.end).toHaveBeenCalled();
	});
});
