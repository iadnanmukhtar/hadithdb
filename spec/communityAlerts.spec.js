'use strict';
const Community = require('../lib/Community');
const Alerts = require('../lib/CommunityAlerts');
afterEach(() => jest.restoreAllMocks());

test('alert responses expose only public identities and opaque event identifiers', async () => {
  jest.spyOn(Community, 'ensure').mockResolvedValue();
  jest.spyOn(Community, 'sql')
    .mockResolvedValueOnce([{ through_at: new Date('2026-10-26T12:00:00Z') }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ event_key:'like:post:1945:private-actor-uid',kind:'like',name:'private@example.test',actor_handle:null,post_id:1945,post_handle:'writer',source:'post',title:'Public post',event_at:new Date('2026-10-26T11:00:00Z') }]);
  const result = await Alerts.unread({uid:'owner'});
  expect(result.items[0].author).toEqual({name:'Community member',handle:null});
  expect(result.items[0].id).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toMatch(/private@example|private-actor-uid/);
  expect(result.items[0].url).toBe('/community/@writer/1945');
});

test('unauthenticated reads and malformed read markers cannot reach storage', async () => {
  const query = jest.spyOn(Community, 'sql');
  await expect(Alerts.unread(null)).rejects.toMatchObject({status:401});
  await expect(Alerts.markRead({uid:'owner'},'invalid')).rejects.toMatchObject({status:400});
  expect(query).not.toHaveBeenCalled();
});
