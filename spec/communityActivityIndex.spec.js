'use strict';
const Index=require('../lib/CommunityActivityIndex');
const base={scope:'everyone',kind:'all',offset:0};
const rows=(n=21)=>Array.from({length:n},(_,i)=>({id:100-i,source:'hadith_like',source_id:1000-i,raw_time:'2026-10-29 12:34:56.123000',activity_at:new Date('2026-10-29T12:34:56.123Z')}));
function db(entries=rows()) {return jest.fn(async sql=>sql.startsWith('SELECT version')?[{version:1}]:entries);}
test('selects only 20 source IDs and a lookahead; deep cursor pages never increase the candidate limit',async()=>{
 const q=db();const first=await Index.page(q,base);
 expect(first.rows).toHaveLength(20);expect(first.ids.hadith_like).toHaveLength(20);expect(first.hasMore).toBe(true);
 const later=await Index.page(q,{...base,offset:9000,cursor:first.cursor});
 const [sql,params]=q.mock.calls[3];expect(sql).toContain('LIMIT 21 OFFSET ?');expect(params.at(-1)).toBe(0);expect(params.slice(1,4)).toEqual(['2026-10-29 12:34:56.123','2026-10-29 12:34:56.123','81']);expect(later.cursor).toBe(first.cursor);
});
test('cursor rejects invalid values and reuse under a different author or feed',async()=>{
 const key=Index.scopeKey(base),cursor=Index.encode({...rows()[0],cursor_time:'2026-10-29 12:34:56.123'},key);
 expect(Index.decode(cursor,key).i).toBe('100');
 for(const bad of ['', '{}','a'.repeat(401),Buffer.from(JSON.stringify({v:1,t:'2026-10-29',i:'1 OR 1=1',s:key})).toString('base64url')])expect(()=>Index.decode(bad,key)).toThrow('Invalid feed cursor');
 await expect(Index.page(db(),{...base,scope:'following',user:{uid:'reader'},cursor})).rejects.toMatchObject({status:400});
});
test('filters scopes and source visibility before the page limit',async()=>{
 const q=db([]);const result=await Index.page(q,{...base,scope:'following',kind:'like',user:{uid:'reader'},author:{uid:'writer'}});
 const [sql,params]=q.mock.calls[1];expect(sql).toContain('community_hidden_activity');expect(sql).toContain('community_follows');expect(sql).toContain('a.actor_uid=?');expect(sql).toContain("p.status='published'");expect(sql).toContain('c.deleted=0');expect(sql).toContain("v.direction='up'");expect(params).toEqual(['reader','reader','writer','like',0]);expect(result).toMatchObject({rows:[],hasMore:false,cursor:null});
});
test('owner drafts remain private and cursor reads cannot silently fall back after disabling the index',async()=>{
 const q=db([]);await Index.page(q,{...base,scope:'mine',kind:'draft',user:{uid:'owner'}});
 expect(q.mock.calls[1][0]).toContain("p.status='draft'");expect(q.mock.calls[1][1]).toEqual(['owner','owner',0]);
 const missing=jest.fn(async()=>{throw Object.assign(Error('missing'),{code:'ER_NO_SUCH_TABLE'});});
 expect(await Index.page(missing,base)).toBeNull();await expect(Index.page(missing,{...base,cursor:'abc'})).rejects.toMatchObject({status:409});
 await expect(Index.page(async()=>{throw Error('connection lost');},base)).rejects.toThrow('connection lost');
});
test('every source has insert/update/delete maintenance, and source content is never copied into the index',()=>{
 expect(Index.sources).toHaveLength(9);
 for(const source of Index.sources){
  const insert=Index.triggerSQL(source,'INSERT','fixture_trigger');expect(insert).toContain('AFTER INSERT');expect(insert).toContain('ON DUPLICATE KEY UPDATE');
  const del=Index.triggerSQL(source,'DELETE','fixture_trigger');expect(del).toContain('source_id=OLD.id');
  expect(Index.triggerSQL(source,'UPDATE','fixture_trigger')).toContain('AFTER UPDATE');
 }
});
test('selected microinteractions load through one bounded source query, without fetching earlier activity',async()=>{
 const q=jest.fn(async(sql,values)=>sql.includes('FROM hadiths_likes l')?[{id:7,user_uid:'reader',handle:'reader',name:'Reader',type:'hadith',ref_num:'bukhari:1',source_title:'Intentions',createdAt:new Date()}]:[]);
 const items=await require('../lib/CommunityLikes').feed(q,{scope:'everyone',limit:21,selection:{hadith_like:[7]}},()=>({html:'',excerpt:''}));
 expect(q).toHaveBeenCalledTimes(1);expect(q.mock.calls[0][0]).toContain('l.id IN (?)');expect(q.mock.calls[0][1]).toEqual(['',[7],21]);expect(items).toHaveLength(1);expect(items[0].sourceRef).toBe('bukhari:1');
});
test('backfill does not activate until every batch succeeds, and locks rows before upserting',async()=>{
 const q=jest.fn();let read=false;const tx=jest.fn(async(sql)=>{
  if(sql.startsWith('SELECT id')){if(!read){read=true;return [{id:1}];}return [];}
  if(sql.startsWith('SELECT COUNT'))return [{eligible:1,missing:0,mismatched:0,stale:0}];
  return {};
 });
 await Index.backfill(q,work=>work(tx));
 expect(tx.mock.calls[0][0]).toContain('FOR UPDATE');expect(tx.mock.calls[2][0]).toContain('ON DUPLICATE KEY UPDATE');
 expect(tx).toHaveBeenLastCalledWith('UPDATE community_activity_state SET version=1 WHERE id=1');
 q.mockClear();await expect(Index.backfill(q,async()=>{throw Error('interrupted');})).rejects.toThrow('interrupted');expect(q).not.toHaveBeenCalled();
});
test('the full feed hydrates only the selected page, including after offset 10000',async()=>{
 const Community=require('../lib/Community');const avatar=jest.spyOn(require('../lib/UserAvatar'),'decorateAuthors').mockResolvedValue();
 const previous=global.dbPool;let selected=0;const sourceReads=[];
 global.dbPool={query(sql,values,callback){
  if(typeof values==='function'){callback=values;values=[];}
  let result=[];
  if(sql.startsWith('SELECT version FROM community_activity_state'))result=[{version:1}];
  else if(sql.includes('FROM community_activity a'))result=selected++===0?rows():[];
  else if(sql.includes('FROM hadiths_likes l')){
   sourceReads.push(values);result=values[1].map(id=>({id,handle:'reader',name:'Reader',source_title:'Intentions',ref_num:'bukhari:1',type:'hadith',createdAt:new Date('2026-10-29')}));
  }
  callback(null,result);
 }};
 try {
  const first=await Community.feed();expect(first.items).toHaveLength(20);expect(first.cursor).toBeTruthy();
  const next=await Community.feed({cursor:first.cursor,offset:10020});expect(next.items).toEqual([]);expect(next.hasMore).toBe(false);
  expect(sourceReads).toHaveLength(1);expect(sourceReads[0][1]).toHaveLength(20);expect(sourceReads[0][2]).toBe(21);
 }finally{global.dbPool=previous;avatar.mockRestore();}
});
test('migration preflight refuses missing or nontransactional sources before writing',async()=>{
 const q=jest.fn(async()=>Index.sources.map(source=>({TABLE_NAME:source.table,ENGINE:source.key==='post'?'MyISAM':'InnoDB'})));
 await expect(Index.install(q)).rejects.toThrow('InnoDB source table: community_posts');
 expect(q).toHaveBeenCalledTimes(1);expect(q.mock.calls[0][0]).toMatch(/^SELECT/);
});
test('verification rejects incomplete coverage before activation',async()=>{
 const q=jest.fn(async sql=>sql.includes('AS eligible')?[{eligible:10,missing:1,mismatched:0}]:[{stale:0}]);
 await expect(Index.verify(q)).rejects.toThrow('verification failed for post');
 expect(q.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});

test.each(['everyone','following','mine'])('Posts excludes generated hadith activity before pagination for %s',async scope=>{
 const q=db([]);await Index.page(q,{...base,scope,kind:'note',user:{uid:'reader'}});
 const sql=q.mock.calls[1][0];
 expect(sql).toContain("a.source='post' AND NOT EXISTS (SELECT 1 FROM community_hadith_posts hp WHERE hp.post_id=a.source_id)");
 expect(sql.indexOf('community_hadith_posts')).toBeLessThan(sql.indexOf('LIMIT 21'));
 q.mockClear();await Index.page(q,{...base,scope,user:{uid:'reader'}});
 expect(q.mock.calls[1][0]).not.toContain('community_hadith_posts');
});
test('fallback Posts query also excludes generated hadith activity before its limit',async()=>{
 const Community=require('../lib/Community'),previous=global.dbPool,queries=[];
 global.dbPool={query(sql,values,callback){if(typeof values==='function')callback=values;queries.push(sql);callback(null,[]);}};
 try {
  await Community.feed({kind:'note'});
  const sql=queries.find(sql=>sql.startsWith('SELECT p.*, a.handle'));
  expect(sql).toContain('NOT EXISTS (SELECT 1 FROM community_hadith_posts hp WHERE hp.post_id=p.id)');
  expect(sql.indexOf('NOT EXISTS')).toBeLessThan(sql.indexOf('LIMIT ?'));
 }finally{global.dbPool=previous;}
});

test('Hidden filters owner posts and microactivity before pagination and has a distinct cursor',async()=>{
 const q=db();const options={...base,scope:'mine',kind:'hidden',user:{uid:'owner'}};
 const result=await Index.page(q,options);
 const [sql,params]=q.mock.calls[1];
 expect(sql).toContain("p.status='private'");
 expect(sql).toContain('hv.source=a.source AND hv.source_id=a.source_id');
 expect(sql).not.toContain('a.kind=?');
 expect(params).toEqual(['owner','owner',0]);
 await expect(Index.page(db(),{...options,kind:'all',cursor:result.cursor})).rejects.toMatchObject({status:400});
 const other=db([]);await Index.page(other,{...options,scope:'everyone'});
 expect(other.mock.calls[1][0]).toContain('AND 1=0');
});
test('legacy hidden activity filtering happens in every source query before LIMIT',async()=>{
 const q=jest.fn(async()=>[]);
 await require('../lib/CommunityLikes').feed(q,{scope:'mine',user:{uid:'owner'},limit:21,hiddenOnly:true},()=>({html:'',excerpt:''}));
 expect(q.mock.calls).toHaveLength(5);
 for(const [sql] of q.mock.calls)expect(sql).toMatch(/AND EXISTS \(SELECT 1 FROM community_hidden_activity hv WHERE hv.source=.*hv.source_id=(l|v).id\)/);
});
