'use strict';
const Pairs = require('../lib/HadithBilingualPairs');

afterEach(() => { delete global.query; Pairs.resetSchemaForTests(); });
test('does not query the catalog when opening the dialog or entering one letter', async () => {
	global.query = jest.fn();
	expect(await Pairs.searchNarrators('')).toEqual([]);
	expect(await Pairs.searchNarrators('ع')).toEqual([]);
	expect(global.query).not.toHaveBeenCalled();
});
test('filters and limits in SQL instead of grouping the entire catalog', async () => {
	global.query = jest.fn(async sql => sql.includes('FROM hdith_narrator_search') && sql.includes('LIKE')
		? [{ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān' }] : sql.includes('MAX(updated_at)') ? [{ updated_at: new Date() }] : []);
	expect(await Pairs.searchNarrators('عثمان', 9999)).toEqual([
		expect.objectContaining({ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān' })
	]);
	const sql = global.query.mock.calls.find(([sql]) => sql.includes('FROM hdith_narrator_search') && sql.includes('LIKE'))[0];
	expect(sql).toContain("LIKE '%عثمان%'");
	expect(sql).toContain('LIMIT 100');
	expect(sql).not.toContain('GROUP BY');
	expect(sql).not.toContain('COUNT(*)');
});
test('preserves managed corrections and hides removed names', async () => {
	global.query = jest.fn(async sql => {
		if (sql.includes('FROM hdith_narrator_search') && sql.includes('LIKE')) return [
			{ value_ar: 'عثمان', value_en: 'Uthman' },
			{ value_ar: 'عثمان بن عفان', value_en: 'Uthman b. Affan' }
		];
		if (sql.includes('MAX(updated_at)')) return [{ updated_at: new Date() }];
		if (sql.includes('FROM hdith_bilingual_pairs')) return [
			{ id: 1, pair_key: 'عثمان', value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān', hidden: 0 },
			{ id: 2, pair_key: 'عثمان بن عفان', value_ar: 'عثمان بن عفان', hidden: 1 }
		];
		return [];
	});
	expect(await Pairs.searchNarrators('عثمان')).toEqual([
		expect.objectContaining({ id: 1, value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān', managed: true })
	]);
});

test.each([['عُثْمَانُ', 'عثمان'], ['ʿUthmān', 'uthman'], ['ʿĀʾishah', 'aishah']])('normalizes %s before SQL search', async (term, normalized) => {
	global.query = jest.fn(async sql => sql.includes('MAX(updated_at)') ? [{ updated_at: new Date() }] : []);
	await Pairs.searchNarrators(term);
	expect(global.query.mock.calls.some(([sql]) => sql.includes(`LIKE '%${normalized}%'`))).toBe(true);
});
