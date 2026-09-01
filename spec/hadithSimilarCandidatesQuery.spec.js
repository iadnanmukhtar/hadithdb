'use strict';

jest.mock('../lib/Index', () => ({
    docsFromObjectArray: jest.fn(async () => [])
}));

const Hadith = require('../lib/Hadith');
const Index = require('../lib/Index');

describe('similar hadith candidate query', () => {
    beforeEach(() => {
        Hadith.similarSuppressionTableReady = false;
        global.query = jest.fn(async () => []);
    });

    test('does not expand a null part and materializes the direct set once', async () => {
        await Hadith.a_dbGetSimilarCandidates({ id: 123, part: null });
        const sql = global.query.mock.calls.map(call => call[0]).find(value => value.includes('WITH direct AS'));

        expect(sql).toBeDefined();
        expect(sql).not.toContain('WHERE part =');
        expect((sql.match(/WITH direct AS/g) || [])).toHaveLength(1);
        expect((sql.match(/FROM hadiths_sim_candidates c, hadiths h, direct/g) || [])).toHaveLength(2);
        expect(sql).not.toContain('ORDER BY rating');
    });

    test('retains indexed part matching for a real part value', async () => {
        await Hadith.a_dbGetSimilarCandidates({ id: 123, part: 'shared-part' });
        const sql = global.query.mock.calls.map(call => call[0]).find(value => value.includes('WITH direct AS'));

        expect(sql).toContain('FROM hadiths WHERE part = "shared-part"');
    });

	 test('keeps explicit states visible through suppression and exposes controls for part matches', async () => {
		Hadith.similarSuppressionTableReady = true;
		global.query = jest.fn(async () => [{
			id: 456, rating: 1, is_candidate: 0, is_actual: 0, is_part: 1, is_direct: 1,
			remove_id1: null, remove_id2: null, bookId: 2, ordinal: 1, part: 'shared-part'
		}]);
		Index.docsFromObjectArray.mockResolvedValueOnce([{
			id: 456, hId: 456, book_id: 2, book_alias: 'muslim', book_virtual: 0, ordinal: 1
		}]);
		const results = await Hadith.a_dbGetSimilarCandidates({ id: 123, part: 'shared-part' });
		const sql = global.query.mock.calls[0][0];

		expect(sql).toContain('x.is_actual=1');
		expect(sql).toContain('(x.is_candidate=1 AND x.is_direct=1)');
		expect(results[0]).toEqual(expect.objectContaining({
			similarActual: true,
			similarDemotable: true,
			similarRemovable: true
		}));
	 });
});
