'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../views/sub-views/scripts.ejs'), 'utf8');

test('a committed save awaiting refresh stays saved, prevents duplicate submission, and offers manual refresh', async () => {
  const controls = { prop: jest.fn() };
  const button = { addClass() { return this; }, text() { return this; }, on: jest.fn().mockReturnThis(), appendTo: jest.fn() };
  const context = {
    saving: false, isVirtual: true, virtualId: 85442, parentId: 0,
    excludedIds: new Set(), excludedRefs: new Set(), $status: {},
    $search: { find: selector => selector.includes('picker-action') ? { val: () => 'replace_selected' } : controls },
    $: () => button, setStatus: jest.fn(), rememberUpdateSuccessToast: jest.fn(),
    update: jest.fn().mockResolvedValue({ code: 200, refreshPending: true }),
    window: { location: { reload: jest.fn() } }
  };
  const start = source.indexOf('const addSuggestion = async');
  const end = source.indexOf('$input.autocomplete({', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.save = addSuggestion;', context);
  await context.save({ id: 56941, ref: 'ahmad:22362' });
  expect(context.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('ahmad:22362 saved.'), false);
  expect(controls.prop).not.toHaveBeenCalledWith('disabled', false);
  expect(context.window.location.reload).not.toHaveBeenCalled();
  await context.save({ id: 56941, ref: 'ahmad:22362' });
  expect(context.update).toHaveBeenCalledTimes(1);
  button.on.mock.calls[0][1]();
  expect(context.window.location.reload).toHaveBeenCalledTimes(1);
});
