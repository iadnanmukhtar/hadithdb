const Utils = require('../lib/Utils');
const sqlite3 = require('sqlite3');
const util = require('util');

describe('cache index cleanup', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('purges orphaned and stale filenames while retaining a fresh gzip cache', async () => {
		const cachedb = {
			allAsync: jest.fn()
				.mockResolvedValueOnce([
					{ filename: '/cache/fresh.html', refs: 3 },
					{ filename: '/cache/stale.html', refs: 2 },
					{ filename: '/cache/missing.html', refs: 4 }
				]),
			runAsync: jest.fn().mockResolvedValue(undefined)
		};
		jest.spyOn(Utils, 'isCacheFileFresh').mockImplementation(filename =>
			filename === '/cache/fresh.html.gz');

		await expect(Utils.purgeStaleCacheIndexEntries(cachedb)).resolves.toEqual({
			files: 2,
			rows: 6
		});
		expect(cachedb.runAsync.mock.calls).toEqual([
			['DELETE FROM cachendx WHERE filename=?;', ['/cache/stale.html']],
			['DELETE FROM cache_files WHERE filename=?;', ['/cache/stale.html']],
			['DELETE FROM cachendx WHERE filename=?;', ['/cache/missing.html']],
			['DELETE FROM cache_files WHERE filename=?;', ['/cache/missing.html']]
		]);
	});

	test('scans cache filenames in bounded batches', async () => {
		const firstBatch = Array.from({ length: 1000 }, (_, index) => ({
			filename: `/cache/${String(index).padStart(4, '0')}.html`,
			refs: 1
		}));
		const cachedb = {
			allAsync: jest.fn()
				.mockResolvedValueOnce(firstBatch)
				.mockResolvedValueOnce([]),
			runAsync: jest.fn().mockResolvedValue(undefined)
		};
		jest.spyOn(Utils, 'isCacheFileFresh').mockReturnValue(true);

		await Utils.purgeStaleCacheIndexEntries(cachedb);

		expect(cachedb.allAsync).toHaveBeenNthCalledWith(2, expect.any(String), [
			'/cache/0999.html',
			1000
		]);
		expect(cachedb.runAsync).not.toHaveBeenCalled();
	});

	test('classifies versioned tafsir cache paths separately', () => {
		expect(Utils.cacheFileType('/srv/.hadithdb/cache/tafsir.v500/rida/page.html')).toBe('tafsir');
		expect(Utils.cacheFileType('/srv/.hadithdb/cache/hadith.v500/bukhari/page.html')).toBe('hadith');
		expect(Utils.cacheFileType('/srv/.hadithdb/cache/fragments.v500/header.html')).toBe('other');
	});

	test('creates persistent FIFO metadata in the cache index database', async () => {
		const cachedb = new sqlite3.Database(':memory:');
		cachedb.runAsync = util.promisify(cachedb.run.bind(cachedb));
		cachedb.allAsync = util.promisify(cachedb.all.bind(cachedb));
		try {
			await Utils.ensureCacheIndexSchema(cachedb);
			const columns = await cachedb.allAsync('PRAGMA table_info(cache_files);');
			expect(columns.map(column => column.name)).toEqual([
				'filename',
				'created_at',
				'size_bytes',
				'cache_type'
			]);
		} finally {
			await util.promisify(cachedb.close.bind(cachedb))();
		}
	});

	test('evicts the oldest files first until the byte ceiling is met', async () => {
		const cachedb = {
			allAsync: jest.fn()
				.mockResolvedValueOnce([{ bytes: 150 }])
				.mockResolvedValueOnce([
					{ filename: '/cache/oldest.html', size_bytes: 60 },
					{ filename: '/cache/newer.html', size_bytes: 50 }
				]),
			runAsync: jest.fn()
		};
		jest.spyOn(Utils, 'deleteManagedCacheFile').mockResolvedValue();

		await expect(Utils.enforceCacheLimit(cachedb, 'tafsir', 100)).resolves.toEqual({
			files: 1,
			bytes: 90
		});
		expect(Utils.deleteManagedCacheFile).toHaveBeenCalledTimes(1);
		expect(Utils.deleteManagedCacheFile).toHaveBeenCalledWith(cachedb, '/cache/oldest.html');
		expect(cachedb.allAsync).toHaveBeenNthCalledWith(2,
			'SELECT filename, size_bytes FROM cache_files WHERE cache_type=? ORDER BY created_at, filename LIMIT 1000;',
			['tafsir']);
	});
});
