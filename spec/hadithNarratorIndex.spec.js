'use strict';
const NarratorIndex = require('../lib/HadithNarratorIndex');
const Pairs = require('../lib/HadithBilingualPairs');
const Index = require('../lib/Index');
const Utils = require('../lib/Utils');
const HdithMetadata = require('../lib/HdithMetadata');
const router = require('../routes/update');
const handler = router.stack.find(layer => layer.route?.path === '/:id/:prop').route.stack.slice(-1)[0].handle;

afterEach(() => { jest.restoreAllMocks(); delete global.query; Pairs.resetSchemaForTests(); });

test('indexes managed primary and chain names without rewriting the source isnad', async () => {
	jest.spyOn(Pairs, 'managed').mockResolvedValue([{ pair_type: 'narrator', pair_key: 'انس', value_ar: 'أَنَس', value_en: 'Anas' }]);
	const query = jest.fn(async sql => sql.includes('FROM hdith_hadith_metadata')
		? [{ hadith_id: 7, narrator: 'أنس', narrator_en: 'Ns' }]
		: [{ hadith_id: 7, ordinal: 1, name: 'أنس', name_ala_lc: 'Ns' }]);
	const rows = [{ hId: 7, chain: 'original isnad' }, { hId: 8 }];
	await NarratorIndex.attach(rows, query);
	expect(rows[0]).toMatchObject({ chain: 'original isnad', narrator: 'أَنَس', narrator_en: 'Anas', narrator_names_search: ['انس'], narrator_names_en_search: ['anas'] });
	expect(rows[1].narrator_names_search).toEqual([]);
});

test('reindexes all unique affected ids and refreshes only after success', async () => {
	global.query = jest.fn(async () => [{ hId: 7 }, { hId: 8 }]);
	jest.spyOn(Index, 'updateBulkPartial').mockResolvedValue();
	jest.spyOn(Index, 'refresh').mockResolvedValue();
	await NarratorIndex.reindex([7, 8, 7]);
	expect(global.query).toHaveBeenCalledWith(expect.stringContaining('hId IN (7,8)'));
	expect(Index.updateBulkPartial).toHaveBeenCalledWith('hadiths', [{ hId: 7 }, { hId: 8 }]);
	expect(Index.refresh).toHaveBeenCalledWith('hadiths');
	Index.updateBulkPartial.mockRejectedValueOnce(new Error('bulk failed'));
	Index.refresh.mockClear();
	await expect(NarratorIndex.reindex([7, 8])).rejects.toThrow('bulk failed');
	expect(Index.refresh).not.toHaveBeenCalled();
});

test('does not silently skip missing affected hadiths', async () => {
	global.query = jest.fn(async () => []);
	await expect(NarratorIndex.reindex([7])).rejects.toThrow('Unable to load all affected hadiths');
});

test('pair save waits for indexing before returning success', async () => {
	jest.spyOn(Pairs, 'save').mockResolvedValue({ affected_book_aliases: ['muslim'], affected_hadith_ids: [7] });
	jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
	jest.spyOn(HdithMetadata, 'invalidatePrimaryNarratorSuggestionCache').mockImplementation(() => {});
	let finish;
	jest.spyOn(NarratorIndex, 'reindex').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
	const req = { body: { value: '', pairType: 'narrator', valueAr: 'أَنَس', valueEn: 'Anas', originalAr: 'أنس' }, params: { id: '0', prop: 'hdith_pair.save' }, user: { uid: 'admin' } };
	const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
	const pending = handler(req, res, jest.fn());
	for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
	expect(NarratorIndex.reindex).toHaveBeenCalledWith([7]);
	expect(res.json).not.toHaveBeenCalled();
	finish();
	await pending;
	expect(res.status).toHaveBeenCalledWith(200);
});

test('pair save reports indexing failure instead of success', async () => {
	jest.spyOn(Pairs, 'save').mockResolvedValue({ affected_book_aliases: [], affected_hadith_ids: [7] });
	jest.spyOn(NarratorIndex, 'reindex').mockRejectedValue(new Error('Narrator indexing failed'));
	const req = { body: { value: '', pairType: 'narrator', valueAr: 'أنس', valueEn: 'Anas' }, params: { id: '0', prop: 'hdith_pair.save' }, user: { uid: 'admin' } };
	const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
	await handler(req, res, jest.fn());
	expect(res.status).toHaveBeenCalledWith(500);
	expect(res.json.mock.calls[0][0].message).toContain('Narrator indexing failed');
});
