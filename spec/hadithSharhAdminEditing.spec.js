'use strict';

const updateRouter = require('../routes/update');
const Books = require('../lib/Books');
const HdithMetadata = require('../lib/HdithMetadata');
const HadithBilingualPairs = require('../lib/HadithBilingualPairs');
const Index = require('../lib/Index');
const Utils = require('../lib/Utils');

function updateHandler() {
	const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
	return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Hadith Sharh administration', () => {
	beforeEach(() => {
		HadithBilingualPairs.resetSchemaForTests();
		jest.spyOn(HdithMetadata, 'ensureEditableColumns').mockResolvedValue();
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

		expect(global.query.mock.calls.some(([sql]) => sql.includes("SET title='عمدة القاري', title_en='ʿUmdat al-Qārī' WHERE id=11"))).toBe(true);
		expect(res.json.mock.calls[0][0].fields).toEqual({ title: 'عمدة القاري', title_en: 'ʿUmdat al-Qārī' });
	});

	test('returns bilingual title pairs while allowing normalized Arabic or English searches', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_bilingual_pairs')) return [];
			if (sql.includes('sharh_pairs')) return [
				{ value_ar: 'فَتْحُ البَارِي', value_en: 'Fatḥ al-Bārī', usage_count: 12 },
				{ value_ar: 'شرح مخصص', value_en: 'Custom explanation', usage_count: 1 }
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
