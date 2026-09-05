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
		expect(Utils.flushCacheContaining).toHaveBeenCalledWith('bukhari:1');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json.mock.calls[0][0].value).toBe(value);
	});
});
