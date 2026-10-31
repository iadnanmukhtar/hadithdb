'use strict';
const Community = require('../lib/Community');
test('handle availability normalizes case and rejects taken, reserved and permanent replacements', async () => {
  const original = global.dbPool, user = {uid:'owner'}, current = {handle:'author-0123456789abcdef'};
  global.dbPool = {query: jest.fn((statement, values, callback) => callback(null, values[0] === 'taken' ? [{uid:'other'}] : []))};
  try {
    await expect(Community.handleAvailability(null, 'writer', current)).rejects.toMatchObject({status:401});
    expect(await Community.handleAvailability(user, 'Writer', current)).toMatchObject({handle:'writer', available:true});
    expect(await Community.handleAvailability(user, 'taken', current)).toMatchObject({available:false, error:'This handle is taken.'});
    for (const handle of ['ab', 'bad handle', 'mine', 'author-fedcba9876543210']) {
      expect((await Community.handleAvailability(user, handle, current)).available).toBe(false);
    }
    expect((await Community.handleAvailability(user, 'writer', {handle:'writer'})).available).toBe(true);
    expect((await Community.handleAvailability(user, 'newname', {handle:'writer'})).available).toBe(false);
    expect(global.dbPool.query.mock.calls[0][0]).toContain('community_author_aliases');
  } finally { global.dbPool = original; }
});
