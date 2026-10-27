'use strict';
const Utils = require('../lib/Utils');
const Tafsir = require('../lib/Tafsir');
function handler(name, path = '/') {
 return require('../routes/' + name).stack.find(layer => layer.route?.path === path).route.stack[0].handle;
}
afterEach(() => jest.restoreAllMocks());
test.each([['tafsirs','tafsir','/'],['translations','translation','/'],['sharh','sharh','/'],['books','tafsir','/tafsir']])('%s catalog permanently redirects to its unified type page', async (route, type, path) => {
 const res = { locals: {}, redirect: jest.fn() };
 jest.spyOn(Utils, 'urlFor').mockImplementation((_req, url) => 'https://hadithunlocked.com' + url);
 await handler(route, path)({ query: {}, hostname: 'quranunlocked.com' }, res, jest.fn());
 expect(res.redirect).toHaveBeenCalledWith(301, 'https://hadithunlocked.com/books?' + type);
});
test.each([['tafsirs','visibleTafsirs'],['translations','visibleTranslations']])('%s retains JSON catalog exports', async (route, method) => {
 const rows = [{ alias: 'sample' }];
 jest.spyOn(Tafsir, method).mockResolvedValue(rows);
 jest.spyOn(Tafsir, 'withFirstPassages').mockResolvedValue(rows);
 jest.spyOn(Utils, 'sendJsonDownload').mockImplementation(() => {});
 const res = { locals: {}, redirect: jest.fn() };
 await handler(route)({ query: { json: '' } }, res);
 expect(Utils.sendJsonDownload).toHaveBeenCalledWith(res, expect.any(String), rows);
 expect(res.redirect).not.toHaveBeenCalled();
});
