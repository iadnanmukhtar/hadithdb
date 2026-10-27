'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../routes/search'), 'utf8');
const helper = source.slice(source.indexOf('async function findNumberedHadithFallback'), source.indexOf('// HADITH (SINGLE)'));
const start = source.indexOf('  var results = await Index.docsFromKeyValue(Item.INDEX, { ref: `${req.params.bookAlias}:${req.params.num}` });');
const block = source.slice(start, source.indexOf('  results = results.map(item => new Item(item));', start));

async function run(number, exact, available, alias = 'muslim') {
  const Index = { docsFromKeyValue: jest.fn(async () => exact), docsFromQuery: jest.fn(async () => available.map(ref => ({ ref }))) };
  const res = { redirect: jest.fn() }, next = jest.fn();
  const req = { params: { bookAlias: alias, num: number } };
  const context = { Index, Item: { INDEX: 'hadiths' }, req, res, next, gone: message => new Error(message), appendOriginalQuery: () => '?json=1&lang=en' };
  await vm.runInNewContext(`${helper}\n(async () => {${block}})()`, context);
  return { Index, res, next };
}

test.each([
 ['2436a', ['muslim:2436'], 'muslim:2436'],
 ['2436', ['muslim:2436a'], 'muslim:2436a'],
 ['2436', ['muslim:2436c', 'muslim:2436b'], 'muslim:2436b'],
 ['2436b', ['muslim:2436c'], 'muslim:2436c']
])('redirects missing %s to canonical reference', async (num, available, expected) => {
 const { res, next, Index } = await run(num, [], available);
 expect(res.redirect).toHaveBeenCalledWith(301, `/${expected}?json=1&lang=en`);
 expect(next).not.toHaveBeenCalled();
 expect(Index.docsFromQuery).toHaveBeenCalledTimes(1);
});
test('exact matches do not redirect or query variants', async () => {
 const { res, Index } = await run('2436', [{ ref: 'muslim:2436' }], []);
 expect(res.redirect).not.toHaveBeenCalled();
 expect(Index.docsFromQuery).not.toHaveBeenCalled();
});
test.each([['2436', 'muslim'], ['13-2', 'malik'], ['2:255', 'quran']])('preserves missing behavior for %s', async (num, alias) => {
 const { res, next } = await run(num, [], [], alias);
 expect(res.redirect).not.toHaveBeenCalled();
 expect(next.mock.calls[0][0].message).toContain('not found');
});
