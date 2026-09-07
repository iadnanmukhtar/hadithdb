'use strict';

const { cachedSimilarRows, confirmedRelationships, resolveRows } = require('../bin/utils/import-hdith-mushabihah-cache');

describe('hdith.com cached mushabihah import', () => {
	test('extracts and deduplicates similar references without changing source identity', () => {
		const rows = cachedSimilarRows({ id: 10, book: { slug: 'b-1' }, similars: [
			{ book_id: 2, entry_id: 20, book: 'مسلم', numbering: '3', tarf: 'طرف' },
			{ book_id: 2, entry_id: 20, book: 'مسلم', numbering: '3', tarf: 'طرف' }
		] }, '/tmp/b-1/10.json.gz');
		expect(rows).toEqual([{ parentBookId: 1, parentEntryId: 10, parentNumber: null, targetBookId: 2, targetEntryId: 20,
			targetBookTitle: 'مسلم', targetNumber: '3', bodyStart: 'طرف' }]);
	});

	test('keeps only targets whose book and exact source entry exist locally', () => {
		const rows = [
			{ parentBookId: 1, parentEntryId: 10, targetBookId: 2, targetEntryId: 20 },
			{ parentBookId: 1, parentEntryId: 10, targetBookId: 9, targetEntryId: 90 }
		];
		const crosswalk = new Map([
			['1:10', { hadithId: 100, localRef: '1', bookId: 1 }],
			['2:20', { hadithId: 200, localRef: '3a', bookId: 2 }]
		]);
		const result = resolveRows(rows, crosswalk, new Map([[2, { bookId: 2, alias: 'muslim' }]]));
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({ parentHadithId: 100, targetHadithId: 200, internalRef: 'muslim:3a' });
		expect(result.statistics.targetBookAbsent).toBe(1);
	});

	test('uses local numbers only for books explicitly mapped as exact', () => {
		const rows = [{ parentBookId: 12, parentEntryId: 1, parentNumber: '4', targetBookId: 15, targetEntryId: 2, targetNumber: '9' }];
		const books = new Map([
			[12, { bookId: 12, alias: 'tabarani', referenceMode: 'exact' }],
			[15, { bookId: 31, alias: 'ibnabishaybah', referenceMode: 'exact' }]
		]);
		const exact = new Map([
			['12:4', { hadithId: 120, localRef: '4', bookId: 12 }],
			['31:9', { hadithId: 310, localRef: '9', bookId: 31 }]
		]);
		const result = resolveRows(rows, new Map(), books, exact);
		expect(result.rows[0]).toMatchObject({ parentHadithId: 120, targetHadithId: 310, internalRef: 'ibnabishaybah:9' });
		expect(result.statistics.exactFallbacks).toBe(2);
	});

	test('stores source similarities as canonical confirmed pairs, never self-links or candidates', () => {
		expect(confirmedRelationships([
			{ parentHadithId: 20, targetHadithId: 10 },
			{ parentHadithId: 10, targetHadithId: 20 },
			{ parentHadithId: 10, targetHadithId: 10 }
		])).toEqual([{ hadithId1: 10, hadithId2: 20 }]);
	});
});
