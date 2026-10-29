'use strict';
const Identity = require('../lib/CommunityPostIdentity');
const C = require('../lib/Community');
test('new identities are distinct UUIDv4 values and appear in public share URLs',()=>{
  const ids = Array.from({length:1000},()=>Identity.create());
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every(Identity.valid)).toBe(true);
  const post = C.postView({id:12,guid:ids[0],handle:'author',kind:'note',public_markdown:'Public text'});
  expect(post.url).toBe('/community/p/'+ids[0]);expect(post.shareUrl).toBe(post.url);
  expect(Identity.url({id:12,guid:ids[0],handle:'renamed'})).toBe(post.url);
});
test('backfill preserves existing identities and assigns random GUIDs only to missing rows',async()=>{
  const existing=Identity.create(), rows=[{id:1,guid:existing},{id:2,guid:null},{id:3,guid:null}];
  const q=jest.fn(async(sql,values)=>{
    if(sql.startsWith('ALTER TABLE'))throw Object.assign(Error(),{code:sql.includes('ADD COLUMN')?'ER_DUP_FIELDNAME':'ER_DUP_KEYNAME'});
    if(sql.startsWith('SELECT'))return rows.filter(r=>r.guid===null).map(r=>({id:r.id}));
    if(sql.startsWith('UPDATE'))for(let i=0;i<values.length-1;i+=2){const row=rows.find(r=>r.id===values[i]);if(row.guid===null)row.guid=values[i+1];}
    return [];
  });
  await Identity.migrate(q);const saved=rows.map(r=>r.guid);await Identity.migrate(q);
  expect(rows[0].guid).toBe(existing);expect(saved.every(Identity.valid)).toBe(true);
  expect(new Set(saved).size).toBe(3);expect(rows.map(r=>r.guid)).toEqual(saved);
  expect(q.mock.calls.filter(([sql])=>sql.startsWith('UPDATE'))).toHaveLength(1);
});
test.each(['12','1 OR 1=1','00000000-0000-1000-8000-000000000000',null,{}])('rejects non-v4 identities: %s',value=>expect(Identity.valid(value)).toBe(false));
