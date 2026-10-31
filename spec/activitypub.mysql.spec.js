'use strict';
// Every SQL identifier is redirected to disposable, uniquely prefixed tables.
// No production/community record is read or modified, and HTTP is mocked.
const mysql = require('mysql');
const {promisify} = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const C = require('../lib/Community');
const AP = require('../lib/ActivityPub');
const Sources = require('../lib/ActivityPubSources');
const Worker = require('../lib/ActivityPubWorker');
const Http = require('../lib/ActivityPubHttp');
jest.setTimeout(120000);
const suite = process.env.HADITHDB_MYSQL_INTEGRATION === '1' ? describe : describe.skip;
suite('isolated ActivityPub publication and federation',()=>{
  const prefix = `ap_test_${process.pid}_${Date.now()}_`;
  const schemas = {
    community_hidden_activity:'source VARCHAR(32),source_id BIGINT,PRIMARY KEY(source,source_id)',
    community_authors:'uid VARCHAR(128) PRIMARY KEY,handle VARCHAR(40),name VARCHAR(120),custom_name INT DEFAULT 1,profile_visibility VARCHAR(7) DEFAULT \'public\'',
    community_posts:'id BIGINT PRIMARY KEY,author_uid VARCHAR(128),status VARCHAR(16),public_title TEXT,public_subtitle TEXT,public_markdown TEXT,public_cover_url TEXT,published_at DATETIME(3)',
    community_blog_imports:'post_id BIGINT,slug VARCHAR(255)',
    community_comments:'id BIGINT PRIMARY KEY,post_id BIGINT,author_uid VARCHAR(128),parent_id BIGINT,markdown TEXT,deleted INT DEFAULT 0,created_at DATETIME(3)',
    community_likes:'id BIGINT PRIMARY KEY,source VARCHAR(32),target_id BIGINT,user_uid VARCHAR(128),created_at DATETIME(3)',
    community_reposts:'id BIGINT PRIMARY KEY,source VARCHAR(32),target_id BIGINT,user_uid VARCHAR(128),created_at DATETIME(3)',
    hadiths_likes:'id BIGINT PRIMARY KEY,user_uid VARCHAR(128),ref_num VARCHAR(100),type VARCHAR(20),hadithId BIGINT,createdAt DATETIME(3)'
  };
  for(const source of ['hadiths_comments','blog_comments']) {
    schemas[source]='id BIGINT PRIMARY KEY,user_uid VARCHAR(128),text TEXT,parentId BIGINT,deleted INT DEFAULT 0,ref_num VARCHAR(100),type VARCHAR(20),hadithId BIGINT,post_slug VARCHAR(255),createdAt DATETIME(3)';
    schemas[source+'_votes']='id BIGINT PRIMARY KEY,user_uid VARCHAR(128),commentId BIGINT,direction VARCHAR(4)';
  }
  const apTables = ['actors','followers','objects','deliveries','receipts','cursors','activities'].map(n=>'activitypub_'+n);
  const names = [...Object.keys(schemas),...apTables];
  const matcher = new RegExp("'(?:''|[^'])*'|\\b("+names.join('|')+")\\b",'g');
  const rewrite = sql => sql.replace(matcher,(whole,name)=>name?prefix+name:whole);
  let pool,q,server,base,actor,other;
  const prior = {pool:global.dbPool,settings:global.settings,enabled:process.env.ACTIVITYPUB_ENABLED,origin:process.env.ACTIVITYPUB_ORIGIN};
  beforeAll(async()=>{
    pool=mysql.createPool({...require('../bin/initializeHadithAttributions').connectionSettings(),connectionLimit:5});
    q=(sql,values=[])=>promisify(pool.query).call(pool,rewrite(sql),values);
    jest.spyOn(C,'ensure').mockResolvedValue();
    jest.spyOn(C,'sql').mockImplementation(q);
    jest.spyOn(C,'transaction').mockImplementation(async fn=>{
      const conn=await promisify(pool.getConnection).call(pool),query=(s,v=[])=>promisify(conn.query).call(conn,rewrite(s),v);
      try{await query('START TRANSACTION');const result=await fn(query);await query('COMMIT');return result;}
      catch(e){await query('ROLLBACK');throw e;}finally{conn.release();}
    });
    process.env.ACTIVITYPUB_ENABLED='1';process.env.ACTIVITYPUB_ORIGIN='https://hadith.example';
    global.settings={site:{url:'https://hadith.example'}};
    for(const [table,columns] of Object.entries(schemas))await q(`CREATE TABLE ${table} (${columns}) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    await AP.ensure();
    const app=express();app.use(require('../routes/activitypub'));app.use(express.json());
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base='http://127.0.0.1:'+server.address().port;
  });
  beforeEach(async()=>{
    for(const table of names)await q(`DELETE FROM ${table}`);
    await q("INSERT INTO community_authors (uid,handle,name) VALUES ('alice','amina','Amina أحمد'),('bob','reader','Reader')");
    actor=await AP.actorFor(await Sources.author(q,'alice'));other=await AP.actorFor(await Sources.author(q,'bob'));
    await q("INSERT INTO community_posts (id,author_uid,status,public_title,public_markdown,published_at) VALUES (1,'alice','published','Mercy','**Mercy** and رحمة', '2026-01-01')");
    await q('INSERT INTO activitypub_followers (actor_id,remote_hash,remote_actor,inbox,follow_id) VALUES (?,?,?,?,?)',[actor.id,AP.hash('https://remote.example/actor'),'https://remote.example/actor','https://remote.example/inbox','https://remote.example/follow/1']);
  });
  afterAll(async()=>{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(pool){for(const table of names)await q(`DROP TABLE IF EXISTS ${table}`);await promisify(pool.end).call(pool);}
    jest.restoreAllMocks();global.dbPool=prior.pool;global.settings=prior.settings;
    for(const [name,value] of [['ACTIVITYPUB_ENABLED',prior.enabled],['ACTIVITYPUB_ORIGIN',prior.origin]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  });
  const events=async()=> (await q('SELECT activity_json FROM activitypub_deliveries ORDER BY id')).map(r=>JSON.parse(r.activity_json));
  test('publishes, updates, retracts and republishes with stable authors and fresh object IDs',async()=>{
    expect(await AP.syncOne(q,'post',1)).toBe(true);
    const first=(await events())[0];expect(first.type).toBe('Create');expect(first.object.content).toContain('رحمة');
    expect(await AP.syncOne(q,'post',1)).toBe(false);
    await q("UPDATE community_posts SET public_markdown='Updated public text' WHERE id=1");
    await AP.syncOne(q,'post',1);
    const update=(await events())[1];expect(update.type).toBe('Update');expect(update.object.id).toBe(first.object.id);expect(update.object.updated).toBeTruthy();
    expect(await AP.syncOne(q,'post',1)).toBe(false);
    await q("UPDATE community_posts SET status='draft' WHERE id=1");await AP.syncOne(q,'post',1);
    expect((await events())[2]).toMatchObject({type:'Delete',object:{id:first.object.id}});
    await expect(AP.publicObject('post',1,first.object.id.split('/').pop())).rejects.toMatchObject({status:410});
    await q("UPDATE community_posts SET status='published' WHERE id=1");await AP.syncOne(q,'post',1);
    const revived=(await events())[3];expect(revived.type).toBe('Create');expect(revived.object.id).not.toBe(first.object.id);
    await q("UPDATE community_authors SET handle='renamed' WHERE uid='alice'");
    expect((await AP.webfinger('acct:renamed@hadith.example')).links[0].href).toBe(actor.url);
    await q("UPDATE community_authors SET profile_visibility='private' WHERE uid='alice'");await AP.syncOne(q,'post',1);
    expect((await events())[4].type).toBe('Delete');
    await expect(AP.webfinger('acct:renamed@hadith.example')).rejects.toMatchObject({status:404});
    expect(JSON.stringify(AP.actorDocument(await AP.actorById(actor.id)))).not.toContain('Amina');
  });
  test('includes comments, source reflections, all likes and reposts; emits Undo on physical removal',async()=>{
    await q("INSERT INTO community_comments (id,post_id,author_uid,markdown,created_at) VALUES (2,1,'alice','Comment','2026-01-02')");
    for(const source of ['hadiths_comments','blog_comments']){
      await q(`INSERT INTO ${source} (id,user_uid,text,ref_num,hadithId,post_slug,createdAt) VALUES (3,'alice','Reflection','bukhari:1',1,'mercy','2026-01-03')`);
      await q(`INSERT INTO ${source}_votes (id,user_uid,commentId,direction) VALUES (4,'alice',3,'up')`);
    }
    await q("INSERT INTO community_likes VALUES (5,'post',1,'alice','2026-01-04'),(6,'hadiths_comments',3,'alice','2026-01-04')");
    await q("INSERT INTO hadiths_likes (id,user_uid,ref_num,hadithId,createdAt) VALUES (7,'alice','bukhari:1',1,'2026-01-05')");
    await q("INSERT INTO community_reposts VALUES (8,'comment',2,'alice','2026-01-06')");
    // Use a single pinned connection because reconciliation uses transactions.
    const conn=await promisify(pool.getConnection).call(pool);const query=(s,v=[])=>promisify(conn.query).call(conn,rewrite(s),v);
    try{await Worker.reconcile(query);expect((await events()).map(e=>e.type)).toEqual(expect.arrayContaining(['Create','Like','Announce']));
      expect(await q('SELECT * FROM activitypub_objects WHERE active=1')).toHaveLength(9);
      expect(await q("SELECT * FROM activitypub_objects WHERE source='like' AND source_id=6")).toHaveLength(0);
      const before=await events();await Worker.reconcile(query);expect(await events()).toHaveLength(before.length);
      await q('DELETE FROM community_reposts WHERE id=8');await q('DELETE FROM community_likes WHERE id=5');
      await Worker.reconcile(query);expect((await events()).slice(-2).map(e=>e.type)).toEqual(['Undo','Undo']);
    }finally{conn.release();}
  });
  test('public routes and raw signed Follow/Undo work without cookies; replay does not duplicate delivery',async()=>{
    const finger=await fetch(base+'/.well-known/webfinger?resource=acct:amina@hadith.example');expect(finger.status).toBe(200);
    expect(finger.headers.get('content-type')).toContain('application/jrd+json');
    const doc=await fetch(base+new URL(actor.url).pathname).then(r=>r.json());expect(doc.publicKey.owner).toBe(actor.url);expect(JSON.stringify(doc)).not.toContain('private_key');
    const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    const remote={id:'https://second.example/users/bob',inbox:'https://second.example/inbox'};
    const request=jest.spyOn(Http,'request').mockResolvedValue({...remote,publicKey:{id:remote.id+'#main-key',owner:remote.id,publicKeyPem:keys.publicKey}});
    const post=async activity=>{
      const body=JSON.stringify(activity),url=actor.url+'/inbox';
      const headers=Http.sign('POST',url,body,{url:remote.id,private_key:keys.privateKey});
      return new Promise((resolve,reject)=>{
        const request=require('http').request(base+new URL(url).pathname,{method:'POST',headers:{...headers,'content-length':Buffer.byteLength(body)}},res=>{
          res.resume();res.on('end',()=>resolve({status:res.statusCode}));
        });request.on('error',reject);request.end(body);
      });
    };
    try{
      const follow={id:'https://second.example/follows/1',type:'Follow',actor:remote.id,object:actor.url};
      expect((await post(follow)).status).toBe(202);expect((await post(follow)).status).toBe(202);
      expect((await events()).filter(e=>e.type==='Accept')).toHaveLength(1);
      expect((await post({id:'https://second.example/undo/1',type:'Undo',actor:remote.id,object:follow})).status).toBe(202);
      expect(await q('SELECT * FROM activitypub_followers WHERE remote_actor=?',[remote.id])).toHaveLength(0);
    }finally{request.mockRestore();}
    await AP.syncOne(q,'post',1);const create=(await events()).find(e=>e.type==='Create');
    expect((await fetch(base+new URL(create.object.id).pathname)).status).toBe(200);
    expect((await fetch(base+new URL(create.id).pathname)).status).toBe(200);
    const outbox=await fetch(base+new URL(actor.url).pathname+'/outbox?page=0').then(r=>r.json());expect(outbox.orderedItems[0].object.id).toBe(create.object.id);
    const unsigned=await fetch(base+new URL(actor.url).pathname+'/inbox',{method:'POST',headers:{'content-type':Http.TYPE},body:'{"actor":"https://remote.example/actor"}'});expect(unsigned.status).toBe(401);
  });
  test('delivery retries with the same activity ID and rechecks visibility before sending',async()=>{
    await AP.syncOne(q,'post',1);
    const request=jest.spyOn(Http,'request').mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValue(null);
    try{
      expect((await Worker.deliver(q)).failed).toBe(1);const first=JSON.parse(request.mock.calls[0][1].body);
      await q('UPDATE activitypub_deliveries SET available_at=NOW()');expect((await Worker.deliver(q)).sent).toBe(1);
      expect(JSON.parse(request.mock.calls[1][1].body).id).toBe(first.id);
      await q("UPDATE community_posts SET public_markdown='New text'");await AP.syncOne(q,'post',1);
      await q("UPDATE community_authors SET profile_visibility='private' WHERE uid='alice'");
      expect((await Worker.deliver(q)).skipped).toBe(1);expect(request).toHaveBeenCalledTimes(2);
    }finally{request.mockRestore();}
  });
  test('introduces existing posts to new followers before delivering edits',async()=>{
    await q('DELETE FROM activitypub_followers');
    await AP.syncOne(q,'post',1);
    await q('INSERT INTO activitypub_followers (actor_id,remote_hash,remote_actor,inbox,follow_id) VALUES (?,?,?,?,?)',
      [actor.id,AP.hash('https://remote.example/actor'),'https://remote.example/actor','https://remote.example/inbox','https://remote.example/follow/new']);
    await q("UPDATE community_posts SET public_markdown='Edited after the follow' WHERE id=1");
    await AP.syncOne(q,'post',1);
    const request=jest.spyOn(Http,'request').mockResolvedValue(null);
    try{
      expect((await Worker.deliver(q)).sent).toBe(1);
      const sent=request.mock.calls.map(call=>JSON.parse(call[1].body));
      expect(sent.map(a=>a.type)).toEqual(['Create','Update']);
      expect(sent[0].object.id).toBe(sent[1].object.id);
      expect((await AP.publicActivity(sent[0].id.split('/').pop())).type).toBe('Create');
    }finally{request.mockRestore();}
  });
  test('does not federate pending posts or private authors, and keeps identities separate',async()=>{
    expect(actor.id).not.toBe(other.id);
    expect(actor.public_key).not.toBe(other.public_key);
    await q("UPDATE community_posts SET status='pending' WHERE id=1");
    expect(await AP.syncOne(q,'post',1)).toBe(false);
    expect(await events()).toHaveLength(0);
    await q("UPDATE community_posts SET status='published' WHERE id=1");
    await q("UPDATE community_authors SET profile_visibility='private' WHERE uid='alice'");
    expect(await AP.syncOne(q,'post',1)).toBe(false);
    expect(await events()).toHaveLength(0);
    await expect(AP.webfinger('acct:amina@evil.example')).rejects.toMatchObject({status:404});
  });
});
