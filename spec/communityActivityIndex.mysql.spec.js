'use strict';
// Explicitly local-only, disposable database. Never uses the application's DB settings.
const mysql=require('mysql'),{promisify}=require('util');
const Index=require('../lib/CommunityActivityIndex');
const configured=process.env.COMMUNITY_ACTIVITY_TEST_URL;
const suite=configured?describe:describe.skip;
suite('persistent activity index on local MySQL',()=>{
 let pool,q,database,transaction;
 beforeAll(async()=>{
  const url=new URL(configured);
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))throw Error('Activity integration tests require a local disposable MySQL server');
  pool=mysql.createPool({host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),connectionLimit:4,charset:'UTF8MB4_BIN'});
  const raw=promisify(pool.query).bind(pool);database='activity_test_'+process.pid+'_'+Date.now();
  await raw('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',[database]);
  // Qualify connections through changeUser once each is acquired, including transactions.
  const acquire=async()=>{const c=await promisify(pool.getConnection).call(pool);await promisify(c.changeUser).call(c,{database});return c;};
  q=async(sql,values=[])=>{const c=await acquire();try{return await promisify(c.query).call(c,sql,values);}finally{c.release();}};
  transaction=async work=>{const c=await acquire();try{await promisify(c.beginTransaction).call(c);const result=await work(promisify(c.query).bind(c));await promisify(c.commit).call(c);return result;}catch(e){await promisify(c.rollback).call(c);throw e;}finally{c.release();}};
  await require('../lib/CommunityVisibility').migrate(q);
  await q("CREATE TABLE community_posts(id BIGINT PRIMARY KEY,author_uid VARCHAR(128),kind VARCHAR(12),status VARCHAR(16),published_at DATETIME(3),updated_at DATETIME(3)) ENGINE=InnoDB");
  await q("CREATE TABLE community_comments(id BIGINT PRIMARY KEY,post_id BIGINT,author_uid VARCHAR(128),deleted INT,created_at DATETIME(3)) ENGINE=InnoDB");
  for(const table of ['hadiths_comments','blog_comments']){
   await q(`CREATE TABLE ${table}(id BIGINT PRIMARY KEY,user_uid VARCHAR(255),text TEXT,deleted INT,createdAt DATETIME(3)) ENGINE=InnoDB`);
   await q(`CREATE TABLE ${table}_votes(id BIGINT PRIMARY KEY,commentId BIGINT,user_uid VARCHAR(255),direction VARCHAR(8)) ENGINE=InnoDB`);
  }
  await q('CREATE TABLE hadiths_likes(id BIGINT PRIMARY KEY,user_uid VARCHAR(255),createdAt DATETIME(3)) ENGINE=InnoDB');
  for(const table of ['community_likes','community_reposts'])await q(`CREATE TABLE ${table}(id BIGINT PRIMARY KEY,source VARCHAR(32),target_id BIGINT,user_uid VARCHAR(128),created_at DATETIME(3)) ENGINE=InnoDB`);
  await q('CREATE TABLE community_follows(follower_uid VARCHAR(128),author_uid VARCHAR(128),PRIMARY KEY(follower_uid,author_uid)) ENGINE=InnoDB');
  await q("INSERT INTO community_posts VALUES (1,'alice','article','published','2026-01-01','2026-01-01'),(2,'alice','note','draft',NULL,'2026-01-02')");
  await q("INSERT INTO hadiths_likes VALUES (1,'alice','2026-01-03')");
  await Index.install(q);await Index.backfill(q,transaction);
 },30000);
 afterAll(async()=>{if(pool){try{if(database)await promisify(pool.query).call(pool,'DROP DATABASE ??',[database]);}finally{await promisify(pool.end).call(pool);}}});
 test('backfill preserves dates and scopes, mutations and rollback are reflected immediately',async()=>{
  let page=await Index.page(q,{scope:'everyone',kind:'all'});expect(page.rows.map(r=>r.source+':'+r.source_id)).toEqual(['hadith_like:1','post:1']);
  expect((await Index.page(q,{scope:'mine',kind:'draft',user:{uid:'alice'}})).rows.map(r=>r.source_id)).toEqual([2]);
  await q("INSERT INTO community_follows VALUES ('bob','alice')");expect((await Index.page(q,{scope:'following',kind:'all',user:{uid:'bob'}})).rows).toHaveLength(2);
  await expect(transaction(async tx=>{await tx("INSERT INTO hadiths_likes VALUES (2,'bob','2026-01-04')");throw Error('rollback');})).rejects.toThrow('rollback');
  expect((await q("SELECT * FROM community_activity WHERE source='hadith_like' AND source_id=2"))).toHaveLength(0);
  await q("INSERT INTO hadiths_likes VALUES (2,'bob','2026-01-04')");await q("DELETE FROM hadiths_likes WHERE id=2");expect((await q("SELECT * FROM community_activity WHERE source='hadith_like' AND source_id=2"))).toHaveLength(0);
  await q("INSERT INTO community_likes VALUES (1,'post',1,'bob','2026-01-05')");
  await q("UPDATE community_posts SET status='hidden' WHERE id=1");expect((await Index.page(q,{scope:'everyone',kind:'all'})).rows.map(r=>r.source)).toEqual(['hadith_like']);
  await q("UPDATE community_posts SET status='published' WHERE id=1");
 });
 test('native comment votes, deletes, reposts, and source edits update the index',async()=>{
  await q("INSERT INTO hadiths_comments VALUES (1,'alice','Reflection',0,'2026-01-06')");
  await q("INSERT INTO hadiths_comments_votes VALUES (1,1,'bob','up')");
  expect((await q("SELECT * FROM community_activity WHERE source='hadiths_comments_like'"))).toHaveLength(1);
  await q("UPDATE hadiths_comments_votes SET direction='down' WHERE id=1");expect((await q("SELECT * FROM community_activity WHERE source='hadiths_comments_like'"))).toHaveLength(0);
  await q("INSERT INTO community_reposts VALUES (1,'hadiths_comments',1,'bob','2026-01-07')");
  await q("UPDATE hadiths_comments SET deleted=1 WHERE id=1");expect((await Index.page(q,{scope:'everyone',kind:'all'})).rows.some(r=>r.source==='repost'||r.source==='hadiths_comments')).toBe(false);
 });
 test('large tied histories paginate without duplicates and only return 20 hydration IDs',async()=>{
  for(let batch=0;batch<10;batch++)await q('INSERT INTO hadiths_likes(id,user_uid,createdAt) VALUES ?', [Array.from({length:100},(_,i)=>[100+batch*100+i,'bulk','2026-10-29 12:00:00.123'])]);
  const options={scope:'mine',kind:'like',user:{uid:'bulk'}};let cursor=null;const seen=new Set();
  for(let page=0;page<50;page++){
   const result=await Index.page(q,{...options,cursor,offset:page*20});expect(result.rows).toHaveLength(20);
   for(const row of result.rows){expect(seen.has(row.id)).toBe(false);seen.add(row.id);}cursor=result.cursor;
   expect(result.hasMore).toBe(page<49);
  }
  expect(seen.size).toBe(1000);
  // Inspect index use without coupling to MySQL version-specific EXPLAIN estimates.
  const indexes=await q('SHOW INDEX FROM community_activity');expect(indexes.some(i=>i.Key_name==='activity_actor_kind_time')).toBe(true);
 },30000);
});
