'use strict';
const C = require('../lib/Community');
const V = require('../lib/CommunityVisibility');
let q;
beforeEach(()=>{
  q=jest.fn();
  jest.spyOn(C,'transaction').mockImplementation(work=>work(q));
  jest.spyOn(require('../lib/CommunityDrive'),'enqueue').mockResolvedValue();
  jest.spyOn(require('../lib/BlogPageCache'),'invalidate').mockResolvedValue();
});
afterEach(()=>jest.restoreAllMocks());
test('only the owner can hide or restore content',async()=>{
  q.mockResolvedValue([{author_uid:'someone-else',status:'published'}]);
  await expect(V.set({uid:'me'},'post',12,true)).rejects.toMatchObject({status:404});
  expect(q).toHaveBeenCalledTimes(1);
});
test.each(['draft','pending','hidden','deleted'])('cannot bypass %s publication state',async status=>{
  q.mockResolvedValue([{author_uid:'me',status}]);
  await expect(V.set({uid:'me'},'post',12,false)).rejects.toMatchObject({status:409});
  expect(q).toHaveBeenCalledTimes(1);
});
test.each([true,false])('post visibility preserves content and cancels queued mail when hidden: %s',async hidden=>{
  q.mockResolvedValueOnce([{author_uid:'me',status:hidden?'published':'private'}]).mockResolvedValue([]);
  await expect(V.set({uid:'me'},'post',12,hidden)).resolves.toEqual({hidden});
  expect(q).toHaveBeenCalledWith('UPDATE community_posts SET status=?,version=version+1 WHERE id=?',[hidden?'private':'published',12]);
  expect(q.mock.calls.some(([sql])=>sql.includes("status='cancelled'"))).toBe(hidden);
});
test.each(Object.keys(V.sources).filter(s=>s!=='post'))('hide/unhide %s without deleting its underlying interaction',async source=>{
  q.mockResolvedValue([{user_uid:'me'}]);
  await V.set({uid:'me'},source,7,true);
  expect(q).toHaveBeenCalledWith('INSERT IGNORE INTO community_hidden_activity (source,source_id) VALUES (?,?)',[source,7]);
  await V.set({uid:'me'},source,7,false);
  expect(q).toHaveBeenCalledWith('DELETE FROM community_hidden_activity WHERE source=? AND source_id=?',[source,7]);
});
test('requires authentication and strict boolean input',async()=>{
  await expect(V.set(null,'post',7,true)).rejects.toMatchObject({status:401});
  await expect(V.set({uid:'me'},'post',7,'false')).rejects.toMatchObject({status:400});
  await expect(V.set({uid:'me'},'anything',7,true)).rejects.toMatchObject({status:400});
});
test('owner decoration distinguishes repost ownership from original author',async()=>{
  q.mockResolvedValueOnce([{handle:'mine'}]).mockResolvedValueOnce([{source:'repost',source_id:9}]);
  const items=[{activity:'repost',id:9,author:{handle:'other'},repostedBy:{handle:'mine'}},{activity:'post',id:10,status:'published',author:{handle:'other'}}];
  await V.decorate(q,items,{uid:'me'});
  expect(items[0]).toMatchObject({canHide:true,hiddenFromOthers:true});
  expect(items[1].canHide).toBeUndefined();
});
test('privately hidden post is unavailable even to a non-owner moderator',async()=>{
  jest.spyOn(C,'ensure').mockResolvedValue();
  // post() closes over sql/ensure; use its real SQL adapter with a stub pool.
  const oldPool=global.dbPool;
  global.dbPool={query(sql,params,callback){callback(null,sql.startsWith('SELECT p.*')?[{id:12,author_uid:'owner',status:'private'}]:[]);}};
  const oldModerators=process.env.COMMUNITY_MODERATOR_UIDS;
  process.env.COMMUNITY_MODERATOR_UIDS='moderator';
  try {await expect(C.post(12,{uid:'moderator'})).rejects.toMatchObject({status:404});}
  finally {global.dbPool=oldPool;if(oldModerators===undefined)delete process.env.COMMUNITY_MODERATOR_UIDS;else process.env.COMMUNITY_MODERATOR_UIDS=oldModerators;}
});

test('public feed retains published status so owners can hide their generated activity',async()=>{
  jest.resetModules();
  const Community=require('../lib/Community');
  const oldPool=global.dbPool;
  const avatar=jest.spyOn(require('../lib/UserAvatar'),'decorateAuthors').mockResolvedValue();
  global.dbPool={query(sql,params,callback){
    let rows=[];
    if(sql.includes('SELECT p.*, a.handle')) rows=[{id:12,kind:'note',status:'published',author_uid:'me',handle:'mine',name:'Mine',public_title:'Example',public_markdown:'Body',published_at:new Date(),updated_at:new Date()}];
    else if(sql==='SELECT handle FROM community_authors WHERE uid=?') rows=[{handle:'mine'}];
    callback(null,rows);
  }};
  try {
    const result=await Community.feed({scope:'everyone',kind:'note'},{uid:'me'});
    expect(result.items[0]).toMatchObject({id:12,status:'published',canHide:true,hiddenFromOthers:false});
    expect(result.items[0].markdown).toBeUndefined();
  } finally {global.dbPool=oldPool;avatar.mockRestore();}
});
