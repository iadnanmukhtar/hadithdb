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
        expect(sql).not.toContain('UNION ALL');
        expect(sql).not.toContain('ORDER BY rating');
    });

    test('loads all similar IDs beyond the search page limit in bounded batches', async () => {
        Hadith.similarSuppressionTableReady = true;
        Index.docsFromObjectArray.mockClear();
        global.query = jest.fn(async () => Array.from({ length: 601 }, (_, index) => ({ id: index + 1000 })));
        await Hadith.a_dbGetSimilarCandidates({ id: 123, part: null });
        const calls = Index.docsFromObjectArray.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls.map(call => call[4])).toEqual([500, 101]);
        expect(calls.flatMap(call => call[1]).map(row => row.id)).toEqual(Array.from({ length: 601 }, (_, index) => index + 1000));
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

describe('similar relationship symmetry', () => {
    const sqlite3 = require('sqlite3');
    let db;
    const run = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
    const query = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
    const matches = async id => {
        await Hadith.a_dbGetSimilarCandidates({ id, part: id === 3 || id === 4 ? 'shared' : null });
        const sql = global.query.mock.calls.at(-1)[0];
        return query(sql);
    };

    beforeEach(async () => {
        db = new sqlite3.Database(':memory:');
        Hadith.similarSuppressionTableReady = true;
        global.query = jest.fn(async () => []);
        await run(`
            CREATE TABLE hadiths (id INTEGER, bookId INTEGER, ordinal INTEGER, part TEXT);
            CREATE TABLE hadiths_sim (hadithId1 INTEGER, hadithId2 INTEGER);
            CREATE TABLE hadiths_sim_candidates (hadithId1 INTEGER, hadithId2 INTEGER, rating REAL);
            CREATE TABLE hadiths_sim_suppressed (hadithId1 INTEGER, hadithId2 INTEGER);
            INSERT INTO hadiths VALUES (1,1,1,NULL),(2,1,2,NULL),(3,1,3,'shared'),(4,1,4,'shared'),(5,1,5,NULL);
            INSERT INTO hadiths_sim VALUES (1,2);
            INSERT INTO hadiths_sim_candidates VALUES (2,3,0.8),(3,5,0.5);
        `);
    });

    afterEach(() => new Promise(resolve => db.close(resolve)));

    test('returns direct relationships reciprocally without expanding through any edge type', async () => {
        const rows = new Map();
        for (const id of [1,2,3,4,5]) rows.set(id, await matches(id));
        for (const [id, similar] of rows) {
            for (const match of similar) expect(rows.get(match.id).some(row => row.id === id)).toBe(true);
            expect(similar.some(row => row.id === id)).toBe(false);
        }
        const ids = id => [...new Set(rows.get(id).map(row => row.id))].sort();
        expect(ids(1)).toEqual([2]);
        expect(ids(2)).toEqual([1, 3]);
        expect(ids(3)).toEqual([2, 4]);
        expect(ids(4)).toEqual([3]);
        expect(rows.get(3)).toContainEqual(expect.objectContaining({ id: 2, is_candidate: 1, is_actual: 0, is_direct: 1 }));
        expect(rows.get(5)).toEqual([]);
    });

    test('suppresses shared-part links both ways but preserves explicit relationships', async () => {
        await run('INSERT INTO hadiths_sim_suppressed VALUES (3,4),(1,2),(2,3);');
        expect((await matches(3)).some(row => row.id === 4)).toBe(false);
        expect((await matches(4)).some(row => row.id === 3)).toBe(false);
        expect((await matches(2)).some(row => row.id === 3)).toBe(true);
        expect((await matches(3)).some(row => row.id === 2)).toBe(true);
        expect((await matches(1)).some(row => row.id === 2)).toBe(true);
        expect((await matches(2)).some(row => row.id === 1)).toBe(true);
    });
});
