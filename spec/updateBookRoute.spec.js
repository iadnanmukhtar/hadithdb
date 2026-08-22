'use strict';

const updateRouter = require('../routes/update');
const Books = require('../lib/Books');
const Hadith = require('../lib/Hadith');
const Utils = require('../lib/Utils');

function updateHandler() {
  const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('book update route', () => {
  beforeEach(() => {
    jest.spyOn(Books, 'ensureBookContentLastmodColumn').mockResolvedValue();
    jest.spyOn(Hadith, 'a_reinit').mockResolvedValue();
    jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
    jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.query;
  });

  test('accepts the alias Set while invalidating tafsir caches', async () => {
    const book = { id: 100382, alias: 'rida', type: 'tafsir', virtual: 0 };
    global.query = jest.fn(async query => {
      if (/^SELECT \* FROM books/.test(query.trim()))
        return [book];
      if (/^UPDATE books SET description=/.test(query.trim()))
        return { affectedRows: 1, message: 'updated' };
      return [];
    });
    const req = {
      body: { value: 'A *valid* Markdown description.' },
      params: { id: '100382', prop: 'book.description' },
      user: { uid: 'admin' }
    };
    const res = {
      status: jest.fn(),
      end: jest.fn()
    };

    await updateHandler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ code: 200, value: req.body.value });
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('tafsir:rida');
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('translation:rida');
  });
});
