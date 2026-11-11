'use strict';
jest.mock('../lib/Community',()=>({ensure:jest.fn(),sql:jest.fn(),transaction:jest.fn(),displayTitle:()=> 'Kindness',content:()=>({html:'Kindness',excerpt:'A short article'})}));
jest.mock('../lib/NotificationPreferences',()=>({categories:{articles:'Articles'},forEmail:jest.fn()}));
const Community=require('../lib/Community'),Preferences=require('../lib/NotificationPreferences');
const old=global.settings;
afterEach(()=>{global.settings=old;jest.clearAllMocks();});
test.each(['note','article'].flatMap(kind => [false,true].flatMap(enabled => [false,true].map(category => [kind,enabled,category]))))('queued %s rechecks preferences (enabled=%s, category=%s)',async (kind,enabled,category)=>{
  const allowed=enabled && category;
  global.settings={site:{url:'https://example.com'},smtp:{from:'sender@example.com'}};
  Community.transaction.mockResolvedValueOnce({id:1,follower_uid:'reader',post_id:2}).mockResolvedValue(null);
  Community.sql.mockImplementation(async sql=>sql.startsWith('SELECT')?[{id:2,kind,guid:'12345678-1234-4234-8234-123456789abc',public_title:'Kindness',public_markdown:'Text',name:'Author',handle:'author',email:'reader@example.com',unsubscribe_token:'b'.repeat(64)}]:[]);
  Preferences.forEmail.mockResolvedValue({enabled:Number(enabled),articles:Number(category),unsubscribe_token:'a'.repeat(64)});
  const sendMail=jest.fn().mockResolvedValue({});
  const result=await require('../lib/CommunityMail').deliverBatch({transport:{sendMail}});
  expect(result).toEqual({sent:allowed?1:0,skipped:allowed?0:1,failed:0});
  expect(sendMail).toHaveBeenCalledTimes(allowed?1:0);
  if(allowed) {
    expect(sendMail.mock.calls[0][0].html).toContain('/community/email-preferences');
    expect(sendMail.mock.calls[0][0].text).toContain(kind==='note'?'Read note:':'Read article:');
  }
});
