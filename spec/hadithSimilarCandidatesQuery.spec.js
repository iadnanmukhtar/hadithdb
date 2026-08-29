'use strict';

jest.mock('../lib/Index', () => ({
    docsFromObjectArray: jest.fn(async () => [])
}));

const Hadith = require('../lib/Hadith');

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
});
