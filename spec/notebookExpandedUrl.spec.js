'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const extract = name => source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0];
function harness(path = '/bukhari:1?search=test') {
  const location = { href: 'https://example.com' + path, pathname: path.split('?')[0], search: path.includes('?') ? '?' + path.split('?')[1] : '' };
  const ctx = vm.createContext({ URL, URLSearchParams, location, expandedReturnUrl: null,
    current: { source_key: 'general:abc' }, quranApiPath: p => '/api' + p,
    window: { history: { state: null, replaceState: jest.fn((state, unused, url) => { location.href = url; }) }, hadithAuth: { getToken: async () => 'token' } },
    open: jest.fn(async () => {}), setExpanded: jest.fn(), openWiki: jest.fn() });
  vm.runInContext(extract('syncExpandedUrl') + '\n' + extract('openRequestedWiki'), ctx);
  return ctx;
}
test('expanded URLs use stable source identities and restore the original reader URL', () => {
  const ctx = harness();
  ctx.syncExpandedUrl(true);
  expect(ctx.location.href).toBe('https://example.com/notebook?note_source=general%3Aabc');
  ctx.current.source_key = 'item:42'; ctx.syncExpandedUrl(true);
  expect(ctx.location.href).toContain('note_source=item%3A42');
  ctx.syncExpandedUrl(false);
  expect(ctx.location.href).toBe('https://example.com/bukhari:1?search=test');
});
test('refresh opens the exact note and restores expanded mode', async () => {
  const ctx = harness('/notebook?note_source=general%3Aabc');
  await ctx.openRequestedWiki();
  expect(ctx.open).toHaveBeenCalledWith(expect.objectContaining({ source_key: 'general:abc' }));
  expect(ctx.setExpanded).toHaveBeenCalledWith(true);
});
test('Quran expanded URLs stay on the Quran route', () => {
  const ctx = harness('/quran/notebook'); ctx.quranApiPath = p => '/quran/api' + p;
  ctx.syncExpandedUrl(true);
  expect(ctx.location.href).toBe('https://example.com/quran/notebook?note_source=general%3Aabc');
});
test('direct expanded URLs close back to the notebook', () => {
  const ctx = harness('/notebook?note_source=general%3Aabc');
  ctx.syncExpandedUrl(true); ctx.syncExpandedUrl(false);
  expect(ctx.location.href).toBe('https://example.com/notebook');
});
