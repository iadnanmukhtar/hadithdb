'use strict';

const updateRouter = require('../routes/update');
const Books = require('../lib/Books');
const HdithMetadata = require('../lib/HdithMetadata');
const HadithBilingualPairs = require('../lib/HadithBilingualPairs');
const HadithHeadingSharh = require('../lib/HadithHeadingSharh');
const Index = require('../lib/Index');
const Utils = require('../lib/Utils');

function updateHandler() {
	const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
	return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Hadith Sharh administration', () => {
	beforeEach(() => {
		HadithBilingualPairs.resetSchemaForTests();
		HadithHeadingSharh.resetSchemaForTests();
		jest.spyOn(HdithMetadata, 'ensureEditableColumns').mockResolvedValue();
		jest.spyOn(require('../lib/SharhBooks'), 'sync').mockResolvedValue({ created: 0 });
		jest.spyOn(require('../lib/SharhBooks'), 'assignEntryBook').mockImplementation(async (kind, id, values) => ({ id: 100, shortName: values.title, shortName_en: values.title_en }));
        jest.spyOn(require('../lib/Model').Library, 'reloadBooks').mockResolvedValue();
        jest.spyOn(require('../lib/RuntimeRefresh'), 'publish').mockResolvedValue();
		jest.spyOn(Books, 'touchBookContentLastmodById').mockResolvedValue();
		jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
		jest.spyOn(Index, 'update').mockResolvedValue();
	});

	afterEach(() => {
		jest.restoreAllMocks();
		HdithMetadata.invalidateSharhTitleSuggestionCache();
		delete global.query;
	});

	test('reorders every explanation belonging to the hadith', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('SELECT id FROM hadiths WHERE id=123')) return [{ id: 123 }];
			if (sql.includes('SELECT id FROM hdith_hadith_sharh WHERE hadith_id=123')) return [{ id: 11 }, { id: 12 }];
			if (sql.includes('FROM v_hadiths') && sql.includes('hId=123')) return [{ id: 123, hId: 123, book_id: 1, book_alias: 'bukhari', num: '1', ref: 'bukhari:1' }];
			return [];
		});
		const req = { body: { value: '12,11' }, params: { id: '123', prop: 'hdith_sharh.reorder' }, user: { uid: 'admin' } };
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(global.query.mock.calls.some(([sql]) => sql.includes('SET ordinal=CASE id WHEN 12 THEN 1 WHEN 11 THEN 2 END'))).toBe(true);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	test('a slow failed revision keeps the connection alive and returns an error envelope', async () => {
		jest.useFakeTimers();
		try {
			global.query = jest.fn(async sql => sql.includes('WHERE hs.id=11')
				? [{ id: 11, hadith_id: 123, source_id: 4, text: 'شرح' }] : []);
			let fail;
			jest.spyOn(require('../lib/ContentRevision'), 'revise').mockImplementation(() => new Promise((resolve, reject) => { fail = reject; }));
			const res = {
				headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn(), end: jest.fn(), setHeader: jest.fn(), once: jest.fn(),
				write: jest.fn(() => { res.headersSent = true; })
			};
			const task = updateHandler()({ body: { value: '' }, params: { id: '11', prop: 'hdith_sharh.revise' }, user: { uid: 'admin' } }, res, jest.fn());
			await jest.advanceTimersByTimeAsync(65000);
			expect(res.write).toHaveBeenCalledTimes(4);
			fail(Object.assign(new Error('Provider unavailable'), { status: 502 }));
			await task;
			expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ code: 502, message: 'Provider unavailable' });
			expect(res.json).not.toHaveBeenCalled();
			await jest.advanceTimersByTimeAsync(15000);
			expect(res.write).toHaveBeenCalledTimes(4);
		} finally {
			jest.useRealTimers();
		}
	});

	test('updates both title languages from a paired autocomplete selection', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('WHERE hs.id=11')) return [{ id: 11, hadith_id: 123, source_id: 4, source_book_id: -1, title: 'فتح الباري', title_en: 'Fatḥ al-Bārī', text: 'شرح' }];
			if (sql.includes('FROM v_hadiths') && sql.includes('hId=123')) return [{ id: 123, hId: 123, book_id: 1, book_alias: 'bukhari', num: '1', ref: 'bukhari:1' }];
			return [];
		});
		const req = {
			body: { value: 'عمدة القاري', pairedSharhTitle: 'ʿUmdat al-Qārī' },
			params: { id: '11', prop: 'hdith_sharh.title' }, user: { uid: 'admin' }
		};
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(require('../lib/SharhBooks').assignEntryBook).toHaveBeenCalledWith('hadith', 11, expect.objectContaining({ title: 'عمدة القاري', title_en: 'ʿUmdat al-Qārī' }));
		expect(res.json.mock.calls[0][0].fields).toEqual({ title: 'عمدة القاري', title_en: 'ʿUmdat al-Qārī' });
	});

	test.each(['bukhari', 'riyad'])('adds a custom explanation to a %s heading', async alias => {
		global.query = jest.fn(async sql => {
			if (sql.startsWith('CREATE TABLE')) return { affectedRows: 0 };
			if (sql.includes('FROM toc t JOIN books b') && sql.includes('t.id=42')) return [{ id: 42, book_id: 7, alias }];
			if (sql.includes('SELECT id FROM hdith_sharh_sources')) return [{ id: 9 }];
			if (sql.includes('MIN(source_entry_id)')) return [{ source_entry_id: -2 }];
			if (sql.includes('MAX(ordinal)')) return [{ ordinal: 3 }];
			if (sql.includes('INSERT INTO hdith_toc_sharh')) return { insertId: 77 };
			return [];
		});
		const req = { body: { value: '' }, params: { id: '42', prop: 'hdith_toc_sharh.add' }, user: { uid: 'admin' } };
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(global.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO hdith_toc_sharh') && sql.includes("'شرح مخصص'"))).toBe(true);
		expect(Books.touchBookContentLastmodById).toHaveBeenCalledWith(7);
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith(alias);
		expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ code: 200, createdSharhId: 77 }));
		expect(require('../lib/SharhBooks').sync).toHaveBeenCalled();
	});

	test('updates both heading explanation title languages from a paired selection', async () => {
		global.query = jest.fn(async sql => {
			if (sql.startsWith('CREATE TABLE')) return { affectedRows: 0 };
			if (sql.includes('WHERE ts.id=31')) return [{
				id: 31, toc_id: 42, source_id: 9, source_book_id: -1, book_id: 7, alias: 'riyad',
				title: 'شرح مخصص', title_en: 'Custom explanation', text: 'شرح'
			}];
			return [];
		});
		const req = {
			body: { value: 'شرح الباب', pairedSharhTitle: 'Chapter explanation' },
			params: { id: '31', prop: 'hdith_toc_sharh.title' }, user: { uid: 'admin' }
		};
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(require('../lib/SharhBooks').assignEntryBook).toHaveBeenCalledWith('heading', 31, expect.objectContaining({ title: 'شرح الباب', title_en: 'Chapter explanation' }));
		expect(res.json.mock.calls[0][0].fields).toEqual({ title: 'شرح الباب', title_en: 'Chapter explanation' });
	});

	test('returns books while allowing normalized Arabic or English searches', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_bilingual_pairs')) return [];
			if (sql.includes('FROM books')) return [
				{ id: 1, value_ar: 'فَتْحُ البَارِي', value_en: 'Fatḥ al-Bārī', usage_count: 12 },
				{ id: 2, value_ar: 'شرح مخصص', value_en: 'Custom explanation', usage_count: 1 }
			];
			return [];
		});

		await expect(HdithMetadata.sharhTitleSuggestions('فتح الباري', 10)).resolves.toEqual([
			expect.objectContaining({ title: 'فَتْحُ البَارِي', title_en: 'Fatḥ al-Bārī' })
		]);
		await expect(HdithMetadata.sharhTitleSuggestions('Fath al-Bari', 10)).resolves.toEqual([
			expect.objectContaining({ title: 'فَتْحُ البَارِي', title_en: 'Fatḥ al-Bārī' })
		]);
	});
});
