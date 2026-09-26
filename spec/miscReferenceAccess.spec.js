'use strict';
const { referencedMiscBook } = require('../lib/MiscReferenceAccess');
const misc = { id: 9999, alias: 'misc', hidden: 1, virtual: 0 };

test('allows a hidden misc record only when it has a visible virtual reference', async () => {
  const query = jest.fn(async () => [{ id: 123 }]);
  expect(await referencedMiscBook('misc', 'mishkat-31', [misc], query)).toBe(misc);
  expect(query.mock.calls[0][0]).toContain("h.num='mishkat-31'");
  expect(query.mock.calls[0][0]).toContain('vb.hidden=0 AND vb.`virtual`=1');
  expect(await referencedMiscBook('misc', 'private', [misc], async () => [])).toBeNull();
});

test('does not expose other hidden books or interpolate reference SQL', async () => {
  const query = jest.fn(async () => []);
  expect(await referencedMiscBook('private', '1', [{ ...misc, alias: 'private' }], query)).toBeNull();
  expect(query).not.toHaveBeenCalled();
  await referencedMiscBook('misc', "x' OR 1=1", [misc], query);
  expect(query.mock.calls[0][0]).toContain("h.num='x\\' OR 1=1'");
});
