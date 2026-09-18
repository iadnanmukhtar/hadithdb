'use strict';
const fs = require('fs');
const vm = require('vm');
const script = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');
const notebook = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const helpers = ['isQuranSubdomainHost', 'quranApiPath'].map(name => script.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');
const api = notebook.match(/  async function api\([^]*?\n  }/)[0];

test.each([
  ['quran.islamunlocked.com', '/tafsir/mokhtasar/2/14', '/quran/api'],
  ['hadithunlocked.com', '/bukhari:100', '/api'],
  ['localhost', '/quran/tafsir/mokhtasar/2/14', '/quran/api'],
  ['localhost', '/notebook', '/api']
])('notebook requests stay on their API mount at %s%s', async (hostname, pathname, prefix) => {
  const fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  const context = vm.createContext({ window: { location: { hostname, pathname }, hadithAuth: { getToken: async () => 'test-token' } }, fetch });
  vm.runInContext(helpers + '\n' + api, context);
  for (const [path, method] of [['?source=tafsir:mokhtasar:2:14', 'GET'], ['/status', 'POST'], ['/preview', 'POST'], ['/expand', 'POST'], ['', 'PUT'], ['', 'DELETE'], ['?offset=12', 'GET']]) {
    await context.api(path, method);
    expect(fetch).toHaveBeenLastCalledWith(prefix + '/notebook' + path, expect.objectContaining({ method, headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }));
  }
  const downloadPath = notebook.match(/fetch\((quranApiPath\('\/notebook\/download'\)),/)[1];
  expect(vm.runInContext(downloadPath, context)).toBe(prefix + '/notebook/download');
});
