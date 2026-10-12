'use strict';

const ejs = require('ejs');
const Utils = require('../lib/Utils');

describe.each(['liked', 'highlights', 'titled', 'requests'])('%s list cache fallback', name => {
  let originalSettings;
  let originalQuery;
  let handler;
  let req;
  let res;

  beforeEach(() => {
    originalSettings = global.settings;
    originalQuery = global.query;
    global.settings = { search: { itemsPerPage: 50 }, site: { url: 'https://hadithunlocked.com' } };
    global.query = jest.fn(async sql => sql.includes('INFORMATION_SCHEMA') ? [{ exists: 1 }] : []);
    handler = require(`../routes/${name}`).stack.find(layer => layer.route.path === '/').route.stack[0].handle;
    req = { query: {}, admin: false, editMode: false };
    res = { app: { locals: {} }, locals: {}, render: jest.fn() };
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/list.html.gz');
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>rebuilt list</html>');
  });

  afterEach(() => {
    global.settings = originalSettings;
    global.query = originalQuery;
    jest.restoreAllMocks();
  });

  test('rebuilds and responds when an existing cache cannot be served', async () => {
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(false);
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(global.query).toHaveBeenCalled();
    expect(Utils.writeCachedHtml).toHaveBeenCalledWith(expect.any(String), '<html>rebuilt list</html>');
    expect(res.render).toHaveBeenCalledWith('hadiths_list', expect.objectContaining({ results: [] }));
  });

  test('returns immediately when the cache response was sent', async () => {
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    await handler(req, res, jest.fn());
    expect(global.query).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  });
});
