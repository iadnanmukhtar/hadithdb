'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../views/sub-views/scripts.ejs'), 'utf8');

test.each([200, 502])('the browser waits for the streamed revision result and handles code %s', async code => {
  let finish;
  const payload = { code, message: code === 200 ? 'Saved' : 'Revision failed', revised: { body: 'Revised text' } };
  const context = {
    window: {},
    editHadithApiPath: path => path,
    fetch: jest.fn().mockResolvedValue({ status: 200, text: () => new Promise(resolve => { finish = resolve; }) }),
    toastr: { success: jest.fn(), error: jest.fn() }
  };
  const start = source.indexOf('async function update(reqBody, options)');
  const end = source.indexOf('function split(val)', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.update = update;', context);
  const pending = context.update({ id: '218207', prop: 'hadith.revise' });
  await new Promise(resolve => setImmediate(resolve));
  expect(context.toastr.success).not.toHaveBeenCalled();
  expect(context.toastr.error).not.toHaveBeenCalled();
  finish(' \n'.repeat(8) + JSON.stringify(payload));
  await expect(pending).resolves.toEqual(payload);
  expect(context.toastr.success).toHaveBeenCalledTimes(code === 200 ? 1 : 0);
  expect(context.toastr.error).toHaveBeenCalledTimes(code === 502 ? 1 : 0);
});

test('the returned revision updates the matching page fields', () => {
  const element = {};
  const context = {
    $: jest.fn(() => ({ each: callback => callback.call(element) })),
    setElementValue: jest.fn()
  };
  const start = source.indexOf('const applyHadithRevision =');
  const end = source.indexOf('const setSimilarToggleButton', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.apply = applyHadithRevision;', context);
  context.apply('218207', { body: 'Revised Arabic', body_en: 'Revised translation' });
  expect(context.$).toHaveBeenCalledWith('[data-id="218207"][data-prop="hadith.body"]');
  expect(context.$).toHaveBeenCalledWith('[data-id="218207"][data-prop="hadith.body_en"]');
  expect(context.setElementValue.mock.calls).toEqual([[element, 'Revised Arabic'], [element, 'Revised translation']]);
});
