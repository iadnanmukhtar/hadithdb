'use strict';

const updateRouter = require('../routes/update');
const Books = require('../lib/Books');
const HdithMetadata = require('../lib/HdithMetadata');
const Index = require('../lib/Index');
const Utils = require('../lib/Utils');

function updateHandler() {
	const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
	return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('hadith narrator inline editing', () => {
	beforeEach(() => {
		global.query = jest.fn(async sql => {
			if (sql.startsWith('UPDATE hdith_hadith_metadata SET')) return { affectedRows: 1 };
			if (sql.includes('FROM v_hadiths') && sql.includes('hId=123')) return [{
				id: 123, hId: 123, book_id: 1, book_alias: 'bukhari', num: '1', ref: 'bukhari:1'
			}];
			return [];
		});
		jest.spyOn(HdithMetadata, 'ensureEditableColumns').mockResolvedValue();
		jest.spyOn(HdithMetadata, 'ensureLocalMetadataRow').mockResolvedValue(true);
		jest.spyOn(Books, 'touchBookContentLastmodById').mockResolvedValue();
		jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
		jest.spyOn(Index, 'update').mockResolvedValue();
	});

	afterEach(() => {
		jest.restoreAllMocks();
		delete global.query;
	});

	test.each([
		['narrator', 'عُثْمَانُ بْنُ عَفَّانَ'],
		['narrator_en', 'ʿUthmān b. ʿAffān']
	])('updates %s and invalidates rendered hadith caches', async (field, value) => {
		const req = { body: { value }, params: { id: '123', prop: `hdith_metadata.${field}` }, user: { uid: 'admin' } };
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(global.query.mock.calls.some(([sql]) => sql.includes(`UPDATE hdith_hadith_metadata SET ${field}=`))).toBe(true);
		expect(HdithMetadata.ensureLocalMetadataRow).toHaveBeenCalledWith(123);
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith('bukhari:1');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json.mock.calls[0][0].value).toBe(value);
	});

	test('adds a manually managed narrator to a hadith without imported metadata', async () => {
		global.query.mockImplementation(async sql => {
			if (sql.includes('MAX(ordinal)')) return [{ ordinal: 1 }];
			if (sql.startsWith('INSERT INTO hdith_narrators')) return { insertId: 456 };
			if (sql.includes('FROM v_hadiths') && sql.includes('hId=123')) return [{
				id: 123, hId: 123, book_id: 1, book_alias: 'bukhari', num: '1', ref: 'bukhari:1'
			}];
			return [];
		});
		const req = { body: { value: 'مُحَمَّدُ بْنُ إِسْمَاعِيلَ' }, params: { id: '123', prop: 'hdith_narrator.add' }, user: { uid: 'admin' } };
		const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

		await updateHandler()(req, res, jest.fn());

		expect(HdithMetadata.ensureLocalMetadataRow).toHaveBeenCalledWith(123);
		expect(global.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO hdith_narrators'))).toBe(true);
		expect(global.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO hdith_hadith_narrators'))).toBe(true);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json.mock.calls[0][0].createdNarratorId).toBe(456);
	});
});

describe('local hadith metadata initialization', () => {
	afterEach(() => {
		delete global.query;
	});

	test('creates the metadata shell when imported metadata is absent', async () => {
		global.query = jest.fn(async sql => sql.startsWith('INSERT IGNORE INTO hdith_hadith_metadata') ? { affectedRows: 1 } : []);

		await expect(HdithMetadata.ensureLocalMetadataRow(123)).resolves.toBe(true);

		const insertSql = global.query.mock.calls[0][0];
		expect(insertSql).toContain("SELECT id, 'admin', id");
		expect(insertSql).toContain('FROM hadiths WHERE id=123');
		expect(insertSql).toMatch(/'[a-f0-9]{64}'/);
	});

	test('accepts a metadata shell that another request already created', async () => {
		global.query = jest.fn(async sql => sql.startsWith('INSERT IGNORE INTO hdith_hadith_metadata')
			? { affectedRows: 0 }
			: [{ hadith_id: 123 }]);

		await expect(HdithMetadata.ensureLocalMetadataRow(123)).resolves.toBe(true);
	});
});
