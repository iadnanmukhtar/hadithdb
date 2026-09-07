'use strict';

const HadithBilingualPairs = require('../lib/HadithBilingualPairs');
const HdithMetadata = require('../lib/HdithMetadata');
const updateRouter = require('../routes/update');

function updateHandler() {
	const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
	return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('hadith bilingual pair library', () => {
	beforeEach(() => {
		HadithBilingualPairs.resetSchemaForTests();
		HdithMetadata.invalidatePrimaryNarratorSuggestionCache();
		HdithMetadata.invalidateSharhTitleSuggestionCache();
	});

	afterEach(() => {
		jest.restoreAllMocks();
		delete global.query;
	});

	test('managed pairs override discovered pairs and hidden pairs disappear', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('narrator_pairs')) return [
				{ value_ar: 'عُثْمَانُ', value_en: 'Uthman', usage_count: 4 },
				{ value_ar: 'عَائِشَةُ', value_en: 'Aishah', usage_count: 3 }
			];
			if (sql.includes('FROM hdith_bilingual_pairs')) return [
				{ id: 10, pair_key: HadithBilingualPairs.normalize('عُثْمَانُ'), value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān', hidden: 0 },
				{ id: 11, pair_key: HadithBilingualPairs.normalize('عَائِشَةُ'), value_ar: 'عَائِشَةُ', value_en: null, hidden: 1 }
			];
			return [];
		});

		await expect(HadithBilingualPairs.list('narrator')).resolves.toEqual([
			expect.objectContaining({ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān', managed: true })
		]);
	});

	test('filters Arabic and English content without diacritics and applies a result limit', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_bilingual_pairs')) return [];
			if (sql.includes('narrator_pairs')) return [
				{ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān', usage_count: 4 },
				{ value_ar: 'عَائِشَةُ', value_en: 'ʿĀʾishah', usage_count: 3 }
			];
			return [];
		});

		await expect(HadithBilingualPairs.list('narrator', 'Uthman', 1)).resolves.toEqual([
			expect.objectContaining({ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān' })
		]);
		await expect(HadithBilingualPairs.list('narrator', 'عثمان', 1)).resolves.toEqual([
			expect.objectContaining({ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān' })
		]);
		await expect(HadithBilingualPairs.list('narrator', 'Aishah', 1)).resolves.toEqual([
			expect.objectContaining({ value_ar: 'عَائِشَةُ', value_en: 'ʿĀʾishah' })
		]);
	});

	test('discovers attribution, chain classification, grader, and grade pairs', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_bilingual_pairs')) return [];
			if (sql.includes('FROM attributions')) return [{ value_ar: 'مرفوع', value_en: 'Prophetic', usage_count: 8 }];
			if (sql.includes('SELECT chain_type')) return [{ chain_type: 'معلق · مرسل', usage_count: 3 }];
			if (sql.includes('grader_pairs')) return [{ value_ar: 'الألباني', value_en: 'al-Albānī', usage_count: 5 }];
			if (sql.includes('FROM grades WHERE')) return [{ value_ar: 'صحيح', value_en: 'Authentic', usage_count: 7 }];
			return [];
		});

		await expect(HadithBilingualPairs.list('attribution')).resolves.toEqual([
			expect.objectContaining({ value_ar: 'مرفوع', value_en: 'Prophetic' })
		]);
		await expect(HadithBilingualPairs.list('chain_classification')).resolves.toEqual(expect.arrayContaining([
			expect.objectContaining({ value_ar: 'معلق', value_en: 'Muʿallaq' }),
			expect.objectContaining({ value_ar: 'مرسل', value_en: 'Mursal' })
		]));
		await expect(HadithBilingualPairs.list('grader')).resolves.toEqual([
			expect.objectContaining({ value_ar: 'الألباني', value_en: 'al-Albānī' })
		]);
		await expect(HadithBilingualPairs.list('grade')).resolves.toEqual([
			expect.objectContaining({ value_ar: 'صحيح', value_en: 'Authentic' })
		]);
		expect(global.query.mock.calls.find(([sql]) => sql.includes('FROM grades WHERE'))[0]).not.toContain('hdith_hadith_grades');
	});

	test('editing a pair keeps its original identity and saves both new values', async () => {
		global.query = jest.fn(async sql => sql.includes('SELECT DISTINCT hadith_id') ? [
			{ hadith_id: 1, alias: 'bukhari' }, { hadith_id: null, alias: 'riyad' }
		] : []);

		const saved = await HadithBilingualPairs.save('sharh_title', 'فَتْحُ البَارِي', 'Fatḥ al-Bārī', 'فتح الباري القديم');

		expect(global.query.mock.calls.some(([sql]) => sql.includes("VALUES ('sharh_title', 'فتح الباري القديم', 'فَتْحُ البَارِي', 'Fatḥ al-Bārī', 0"))).toBe(true);
		expect(global.query.mock.calls.some(([sql]) => sql.includes("hidden=1"))).toBe(false);
		expect(global.query.mock.calls.some(([sql]) => sql.includes('UPDATE hdith_hadith_sharh hs') && sql.includes("hs.title='فَتْحُ البَارِي'"))).toBe(true);
		expect(global.query.mock.calls.some(([sql]) => sql.includes('UPDATE hdith_toc_sharh ts') && sql.includes("ts.title_en='Fatḥ al-Bārī'"))).toBe(true);
		expect(global.query.mock.calls.some(([sql]) => sql.includes('UPDATE hdith_sharh_sources SET') && sql.includes("title='فَتْحُ البَارِي'"))).toBe(true);
		expect(saved.affected_book_aliases).toEqual(['bukhari', 'riyad']);
		expect(saved.affected_hadith_ids).toEqual([1]);
	});

	test.each([
		['narrator', 'UPDATE hdith_hadith_metadata SET narrator=', 'UPDATE hdith_narrators SET name='],
		['attribution', 'UPDATE hdith_hadith_metadata SET attribution=', 'UPDATE attributions SET attribution='],
		['grader', 'UPDATE hdith_hadith_grades SET grader=', 'UPDATE graders SET shortName='],
		['grade', 'UPDATE hdith_hadith_grades SET grade=', 'UPDATE grades SET grade=']
	])('propagates managed %s pairs to their canonical records', async (type, firstUpdate, secondUpdate) => {
		global.query = jest.fn(async sql => sql.includes('SELECT DISTINCT') ? [{ hadith_id: 7, alias: 'muslim' }] : []);
		const saved = await HadithBilingualPairs.save(type, 'القيمة الجديدة', 'New value', 'القيمة القديمة');
		const statements = global.query.mock.calls.map(([sql]) => sql).join('\n');
		expect(statements).toContain(firstUpdate);
		expect(statements).toContain(secondUpdate);
		expect(saved.affected_book_aliases).toEqual(['muslim']);
		expect(saved.affected_hadith_ids).toEqual([7]);
	});

	test('keeps chain classification storage stable while resolving its managed display pair', async () => {
		global.query = jest.fn(async sql => sql.includes('SELECT DISTINCT') ? [{ hadith_id: 7, alias: 'muslim' }] : []);
		await HadithBilingualPairs.save('chain_classification', 'المتصل', 'Connected', 'متصل');
		const statements = global.query.mock.calls.map(([sql]) => sql).join('\n');
		expect(statements).toContain("FIND_IN_SET('متصل'");
		expect(statements).not.toContain('SET chain_type=');
		expect(HadithBilingualPairs.resolve([{ pair_type: 'chain_classification', pair_key: 'متصل', value_ar: 'المتصل', value_en: 'Connected' }],
			'chain_classification', 'متصل', 'Muttaṣil')).toEqual({ value_ar: 'المتصل', value_en: 'Connected' });
	});

	test('admin update saves a complete pair and invalidates autocomplete', async () => {
		global.query = jest.fn(async () => []);
		const invalidate = jest.spyOn(HdithMetadata, 'invalidatePrimaryNarratorSuggestionCache');
		const req = {
			body: { value: '', pairType: 'narrator', valueAr: 'عُمَرُ', valueEn: 'ʿUmar', originalAr: '' },
			params: { id: '0', prop: 'hdith_pair.save' }, user: { uid: 'admin' }
		};
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(invalidate).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json.mock.calls[0][0].pair).toEqual(expect.objectContaining({ value_ar: 'عُمَرُ', value_en: 'ʿUmar' }));
	});
});
