'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const util = require('util');
const Utils = require('../lib/Utils');

describe('full book disk cache flush', () => {
	let root;
	let db;

	beforeEach(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'hadithdb-book-cache-'));
		db = new sqlite3.Database(':memory:');
		db.runAsync = util.promisify(db.run.bind(db));
		db.allAsync = util.promisify(db.all.bind(db));
		await Utils.ensureCacheIndexSchema(db);
	});

	afterEach(async () => {
		await util.promisify(db.close.bind(db))();
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('removes the exact book across cache types and versions only', async () => {
		const targets = [
			path.join(root, 'hadith.v1', 'bukhari', 'page.html'),
			path.join(root, 'hadith.v2', 'bukhari', 'page.html.gz'),
			path.join(root, 'tafsir.v2', 'bukhari', 'toc.html'),
			path.join(root, '_bukhari_feed.html')
		];
		const keep = path.join(root, 'hadith.v2', 'bukhari-notes', 'page.html');
		for (const filename of [...targets, keep]) {
			fs.mkdirSync(path.dirname(filename), { recursive: true });
			fs.writeFileSync(filename, 'cached');
		}
		await db.runAsync('INSERT INTO cachendx(id, filename) VALUES (?, ?)', ['book:bukhari', targets[0]]);
		await db.runAsync('INSERT INTO cache_files(filename, created_at, size_bytes, cache_type) VALUES (?, ?, ?, ?)', [targets[0], 1, 6, 'hadith']);

		const result = await Utils.flushBookDiskCache('bukhari', { cacheRoot: root, db });

		expect(result.files).toBe(4);
		expect(fs.existsSync(keep)).toBe(true);
		for (const filename of targets) expect(fs.existsSync(filename)).toBe(false);
		expect(await db.allAsync('SELECT * FROM cachendx')).toEqual([]);
		expect(await db.allAsync('SELECT * FROM cache_files')).toEqual([]);
	});

	test('rejects path-like aliases', async () => {
		await expect(Utils.flushBookDiskCache('../bukhari', { cacheRoot: root, db })).rejects.toThrow('Invalid book cache alias');
	});

	test('is idempotent when the cache root does not exist', async () => {
		const missing = path.join(root, 'missing');
		await expect(Utils.flushBookDiskCache('bukhari', { cacheRoot: missing, db })).resolves.toEqual({
			alias: 'bukhari', files: 0, directories: 0, targets: 0
		});
	});
});
