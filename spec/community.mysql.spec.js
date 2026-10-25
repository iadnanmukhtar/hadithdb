'use strict';
// Uses uniquely prefixed disposable tables; never reads or changes real community records.
jest.mock('../lib/GoogleAuth', () => ({ verifyRequest: jest.fn(async req => {
  const uid = req.headers.authorization?.replace('Bearer ', '');
  if (uid === 'expired') throw new Error('Expired session');
  return ['alice', 'bob', 'moderator', 'mallory'].includes(uid) ? { uid, name: uid === 'alice' ? 'Amina أحمد' : uid, email: uid + '@private.test' } : null;
}) }));
jest.mock('../lib/NotebookDrive', () => ({ get: jest.fn(async (uid, source) => uid === 'alice' && source === 'item:42' ? { title: 'Notebook title', markdown: '---\nsecret: private metadata\n---\nPrivate notebook body\n\n[[Secret|Label]]', tags: ['learning'] } : null) }));
const mysql = require('mysql');
const { promisify } = require('util');
const express = require('express');
const http = require('http');
const path = require('path');
const Community = require('../lib/Community');
jest.setTimeout(30000);
const suite = process.env.HADITHDB_MYSQL_INTEGRATION === '1' ? describe : describe.skip;
suite('Community publication, privacy, subscriptions, discussion and moderation', () => {
  const prefix = `c_test_${process.pid}_${Date.now()}_`;
  const tables = ['hadith_posts','blog_media_imports','blog_imports','blog_posts','media','link_previews','dislikes','reposts','author_aliases','authors','posts','revisions','follows','comments','reports','email_outbox','likes'];
  const rewrite = statement => statement.replace(/\b(user_profile_photos|hadiths_comments_votes|blog_comments_votes|hadiths_likes|hadiths_comments|blog_comments)\b/g, (_, table) => prefix + table).replace(/\bcommunity_(hadith_posts|blog_media_imports|blog_imports|blog_posts|media|link_previews|dislikes|reposts|author_aliases|authors|posts|revisions|follows|comments|reports|email_outbox|likes)\b/g, (_, table) => prefix + table);
  let pool, server, base, q, firstId, adminSpy, blogDir, pendingQueries=0;
  const trackedQuery=(connection,s,v,cb)=>{pendingQueries++;return connection.query(rewrite(s),v,(err,result)=>{pendingQueries--;cb(err,result);});};
  const request = (url, method = 'GET', uid = 'alice', body) => fetch(base + url, { method, headers: { ...(uid ? { Authorization: 'Bearer ' + uid } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (url, method, uid, body, expected = 200) => { const response = await request(url, method, uid, body); const data = await response.json(); expect({ status: response.status, error: data.error }).toEqual({ status: expected, error: expected >= 400 ? expect.any(String) : undefined }); return data; };
  const postInput = overrides => ({ kind: 'article', title: 'A reflection العربية', markdown: 'Original published body', tags: 'learning', action: 'draft', ...overrides });
  beforeAll(async () => {
    adminSpy=jest.spyOn(require('../lib/UserSettings'),'isAdminUser').mockImplementation(async uid=>uid==='moderator');
    process.env.COMMUNITY_MODERATOR_UIDS = 'moderator';
    pool = mysql.createPool({ ...require('../bin/initializeHadithAttributions').connectionSettings(), connectionLimit: 5, supportBigNumbers: true });
    q = promisify(pool.query).bind(pool);
    const wrapConnection = connection => ({ query: (s,v,cb) => trackedQuery(connection,s,v,cb), beginTransaction: connection.beginTransaction.bind(connection), commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection), release: connection.release.bind(connection) });
    global.dbPool = { query: (s,v,cb) => trackedQuery(pool,s,v,cb), getConnection: cb => pool.getConnection((err, connection) => cb(err, connection && wrapConnection(connection))) };
    global.settings = { sessionSecret:'isolated-avatar-test-secret', site: { name:'HadithDB', shortName:'HadithDB', url:'http://127.0.0.1', desc:'HadithDB', lang:'en', logo:'/static/img/logo2.svg', quranUrl:'http://127.0.0.1' }, smtp: { from:'test@private.test' }, google:{} };
    global.utils = require('../lib/Utils'); global.arabic = require('../lib/Arabic'); global.qs = require('qs'); global.books=[];
    const app = express(); app.locals.googleAnalyticsTagId = ''; app.locals.Tafsir = require('../lib/Tafsir'); app.locals.BookGroups = require('../lib/BookGroups'); app.use(express.json()); app.use(express.urlencoded({extended:false})); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname,'../views'));
    app.use('/api/login', require('../routes/login'));
    blogDir=require('fs').mkdtempSync(path.join(require('os').tmpdir(),'community-blog-test-'));
    require('fs').writeFileSync(path.join(blogDir,'original.md'),'---\ntitle: Original Blog post\npublished: 2020-01-01\n---\nOriginal content.');
    app.use('/blog',require('../routes/blog'));
    app.get(['/notebook', '/quran/notebook'], require('../routes/notebook').page);
    app.use('/static', express.static(path.join(__dirname,'../public/static')));
    app.use('/api/community', require('../routes/community').api); app.use('/quran/api/community', require('../routes/community').api); app.use('/community', require('../routes/community').pages);
    app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({error:err.message}); });
    server=http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port;
    global.settings.site.url=base;
    global.settings.blog={...global.settings.site,dir:blogDir,url:base+'/blog',itemsPerPage:5};
    await Community.ensure();
    for (const source of ['hadiths_comments','blog_comments']) await q(`CREATE TABLE ${prefix}${source} (
      id INT PRIMARY KEY AUTO_INCREMENT, hadithId INT, ref_num VARCHAR(45), type VARCHAR(16), post_slug VARCHAR(255),
      parentId INT, user_uid VARCHAR(255) COLLATE utf8mb4_bin, user_name VARCHAR(255), user_email VARCHAR(255), user_provider VARCHAR(255), user_photo VARCHAR(1024),
      text TEXT, up_vote INT DEFAULT 0, down_vote INT DEFAULT 0, createdAt DATETIME(3), deleted TINYINT DEFAULT 0) DEFAULT CHARSET=utf8mb4`);
    for (const source of ['hadiths_comments_votes','blog_comments_votes']) await q(`CREATE TABLE ${prefix}${source} (
      id INT PRIMARY KEY AUTO_INCREMENT, commentId INT, user_uid VARCHAR(255) COLLATE utf8mb4_bin, direction VARCHAR(8)) DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE ${prefix}hadiths_likes (id INT PRIMARY KEY AUTO_INCREMENT, hadithId INT, type VARCHAR(16), ref_num VARCHAR(45), user_uid VARCHAR(255) COLLATE utf8mb4_bin, user_name VARCHAR(255), createdAt DATETIME(3)) DEFAULT CHARSET=utf8mb4`);
    await Community.authorFor({uid:'original-blog-author',name:'Original author'});
    await require('../lib/CommunityBlogImport').migrate(blogDir,'original-blog-author',true);
  });
  afterAll(async () => {
    if (server) await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>setImmediate(resolve));
    while(pendingQueries) await new Promise(resolve=>setTimeout(resolve,20));
    if (q) for (const source of ['user_profile_photos','hadiths_comments_votes','blog_comments_votes','hadiths_likes','hadiths_comments','blog_comments']) await q(`DROP TABLE IF EXISTS ${prefix}${source}`);
    if (q) for (const table of [...tables].reverse()) await q(`DROP TABLE IF EXISTS ${prefix}${table}`);
    if (pool) await promisify(pool.end).call(pool);
    if(blogDir)require('fs').rmSync(blogDir,{recursive:true,force:true});
    adminSpy?.mockRestore();
    delete process.env.COMMUNITY_MODERATOR_UIDS;
  });
  test('hadith titles and revisions create public, attributed, deduplicated Community posts', async()=>{
    const publish=require('../lib/CommunityHadithPosts').publish;
    const user={uid:'hadith-editor',name:'Hadith Editor'};
    const before={hId:987,ref:'bukhari:1',title_en:'Old title',body_en:'Original translation'};
    const after={...before,title_en:'New title'};
    const postId=await publish(user,'title',before,after);
    const post=await Community.post(postId);
    expect(post.title).toBe('Titled bukhari:1');expect(post.author.name).toBe('Hadith Editor');
    expect(post.html).toContain('/bukhari:1');expect(post.html).toContain('New title');
    expect(await publish(user,'title',before,after)).toBeNull();
    const backfill=require('../lib/CommunityHadithPosts').backfillTitles;
    const historic={...after,hId:988,ref:'bukhari:2',lastmod:'2023-02-03T04:05:06.000Z'};
    expect(await backfill(user,[historic])).toMatchObject({candidates:1,created:0});
    expect(await backfill(user,[historic],true)).toMatchObject({created:1,existing:0});
    expect(await backfill(user,[historic],true)).toMatchObject({created:0,existing:1});
    expect(await publish(user,'title',{...historic,title_en:'Old'},historic)).toBeNull();
    const dated=(await q('SELECT published_at,created_at,updated_at FROM '+prefix+'posts WHERE author_uid=? AND title=?',[user.uid,'Titled bukhari:2']))[0];
    expect(+new Date(dated.published_at)).toBe(+new Date(historic.lastmod));
    expect(+new Date(dated.created_at)).toBe(+new Date(historic.lastmod));

    expect(await publish(user,'title',after,after)).toBeNull();
    expect(await publish(user,'revise',after,null)).toBeNull();
    const revisedId=await publish(user,'revise',after,{...after,body_en:'Revised translation'});
    expect((await Community.post(revisedId)).html).toContain('Revised translation');
    const feed=await Community.feed({scope:'mine'},user);
    expect(feed.items.map(item=>item.id)).toEqual(expect.arrayContaining([postId,revisedId]));
    expect(feed.items.find(item=>item.id===postId)).toMatchObject({microinteraction:'title',hadithTitle:'New title',hadithUrl:'/bukhari:1',canEdit:false});
    expect(feed.items.find(item=>item.id===revisedId).microinteraction).toBeUndefined();
    await Community.authorFor({uid:'hadith-reader',name:'Reader'});
    await Community.follow({uid:'hadith-reader',name:'Reader'},post.author.handle,true,false);
    const following=await Community.feed({scope:'following'},{uid:'hadith-reader'});
    expect(following.items.map(item=>item.id)).toContain(postId);
    expect(following.items.find(item=>item.id===postId).canEdit).toBe(false);
    const ownPublic=await Community.feed({author:post.author.handle},user);
    expect(ownPublic.items.find(item=>item.id===postId).canEdit).toBe(false);
    await expect(Community.post(postId,user,true)).rejects.toMatchObject({status:403});
    await expect(Community.savePost(user,{kind:'note',title:'Changed',markdown:'Changed',version:1},postId)).rejects.toMatchObject({status:403});
    expect(ownPublic.items.find(item=>item.id===postId).markdown).toBeUndefined();
    const page=await fetch(base+'/community');expect(page.status).toBe(200);
    const $=require('cheerio').load(await page.text());
    expect($('.offcanvas-quick-actions a').first().attr('href')).toBe('/community');
    expect($('a[href="/liked"],a[href="/highlights"],a[href="/commented"]').length).toBe(0);

  });
  test('title microinteractions collapse across pages and retain compact titles',async()=>{
    const browser=await require('playwright').chromium.launch({channel:'chrome',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}}),offsets=[];
      await page.addInitScript(()=>{window.quranApiPath=v=>'/api'+v;window.hadithAuth={getToken:async()=>null,getUser:async()=>null};});
      await page.route('**/*',route=>{if(route.request().resourceType()==='script'&&!/community(?:-media)?\.js/.test(route.request().url()))return route.abort();return route.continue();});
      await page.route('**/api/community/feed?*',route=>{
        const offset=Number(new URL(route.request().url()).searchParams.get('offset')||0);offsets.push(offset);
        const items=Array.from({length:Math.min(20,42-offset)},(_,i)=>({id:offset+i+5000,activity:'post',kind:'note',canEdit:true,microinteraction:offset+i<40?'title':undefined,hadithTitle:'Acceptance of dua',hadithRef:'ahmad:11133',hadithUrl:'/ahmad:11133',title:'Titled ahmad:11133',excerpt:'Normal post',author:{handle:'editor',name:'Editor'},url:'/community/@editor/1',activityAt:new Date().toISOString()}));
        return route.fulfill({json:{items,hasMore:offset+20<42,offset:offset+20}});
      });
      await page.goto(base+'/community');
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===20);
      expect(offsets).toEqual([0]);
      expect(await page.locator('#community-feed [data-kind=title]:visible').count()).toBe(10);
      const first=page.locator('#community-feed [data-kind=title]').first();
      expect(await first.locator('h2').count()).toBe(0);
      expect(await first.locator('[aria-label="Edit post"]').count()).toBe(0);
      expect(await first.textContent()).toContain('Acceptance of dua');
      expect((await first.boundingBox()).height).toBeLessThan(90);
      await page.locator('#community-more').click();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===42);
      expect(offsets).toEqual([0,20,40]);
      await page.locator('#community-feed details summary').click();
      expect(await page.locator('#community-feed [data-kind=title]:visible').count()).toBe(40);
    }finally{await browser.close();}
  });
  test('only admins publish existing Blog articles while creators can save drafts',async()=>{
    const owner={uid:'blog-writer',name:'Blog writer'};
    let article=await Community.savePost(owner,postInput());
    await q("UPDATE "+prefix+"posts SET status='published',public_title=title,public_markdown=markdown WHERE id=?",[article.id]);
    await Community.markBlog({uid:'moderator'},article.id,true);
    article=await Community.savePost(owner,postInput({version:article.version,markdown:'Private edit'}),article.id);
    await expect(Community.savePost(owner,postInput({version:article.version,action:'publish'}),article.id)).rejects.toMatchObject({status:403});
    const published=await Community.savePost({...owner,admin:true},postInput({version:article.version,action:'publish'}),article.id);
    expect(published.status).toBe('published');
    await q("UPDATE "+prefix+"posts SET status='pending' WHERE id=?",[article.id]);
    const previous=process.env.COMMUNITY_MODERATOR_UIDS;
    process.env.COMMUNITY_MODERATOR_UIDS=previous+',blog-reviewer';
    try{await expect(Community.moderate({uid:'blog-reviewer'},article.id,{action:'approve',version:published.version})).rejects.toMatchObject({status:403});}
    finally{process.env.COMMUNITY_MODERATOR_UIDS=previous;}
  });
  test('article covers are owner-controlled and draft replacements stay private until publication',async()=>{
    const Media=require('../lib/CommunityMedia'),user={uid:'moderator',name:'Publisher'};
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
    const first=await Media.upload(user,png),second=await Media.upload(user,png);
    let article=await Community.savePost(user,postInput({coverUrl:first.url,action:'publish'}));
    expect((await Community.post(article.id)).coverUrl).toBe(first.url);
    article=await Community.savePost(user,postInput({coverUrl:second.url,version:article.version}),article.id);
    expect(article.coverUrl).toBe(second.url);expect((await Community.post(article.id)).coverUrl).toBe(first.url);
    await expect(Media.image(second.url.split('/').pop(),null)).rejects.toMatchObject({status:404});
    await expect(Community.savePost({uid:'cover-other',name:'Other'},postInput({coverUrl:first.url}))).rejects.toMatchObject({status:400});
    article=await Community.savePost(user,postInput({coverUrl:second.url,action:'publish',version:article.version}),article.id);
    expect((await Media.image(second.url.split('/').pop(),null)).data).toEqual(png);
    await expect(Media.image(first.url.split('/').pop(),null)).rejects.toMatchObject({status:404});
    article=await Community.savePost(user,postInput({coverUrl:'',action:'publish',version:article.version}),article.id);
    expect((await Community.post(article.id)).coverUrl).toBe('');
    await expect(Media.image(second.url.split('/').pop(),null)).rejects.toMatchObject({status:404});
    const browser=await require('playwright').chromium.launch({channel:'chrome',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await page.addInitScript(()=>{window.quranApiPath=v=>'/api'+v;window.hadithAuth={getToken:async()=>'moderator',getUser:async()=>null};});
      await page.route('**/*',route=>{if(route.request().resourceType()==='script'&&!/community(?:-media)?\.js/.test(route.request().url()))return route.abort();return route.continue();});
      await page.goto(base+'/community/write');
      await page.locator('#community-cover-file').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:png});
      await page.waitForFunction(()=>document.getElementById('community-cover-url').value.startsWith('/community/media/'));
      expect(await page.locator('#community-editor-cover img').count()).toBe(1);
      await page.locator('#community-cover-remove').click();
      expect(await page.locator('#community-cover-url').inputValue()).toBe('');
      expect(await page.locator('#community-editor-cover').count()).toBe(0);
    }finally{await browser.close();}
  });
  test('article subtitles preserve public snapshots and backfill legacy metadata only once', async()=>{
    const user={uid:'moderator',name:'Moderator'};
    let saved=await Community.savePost(user,postInput({subtitle:'Published subtitle',action:'publish'}));
    expect((await Community.post(saved.id)).subtitle).toBe('Published subtitle');
    saved=await Community.savePost(user,postInput({subtitle:'Private edit',version:saved.version} ),saved.id);
    expect(saved.subtitle).toBe('Private edit');
    expect((await Community.post(saved.id)).subtitle).toBe('Published subtitle');
    saved=await Community.savePost(user,postInput({subtitle:'',action:'publish',version:saved.version}),saved.id);
    expect((await Community.post(saved.id)).subtitle).toBe('');
    const original=(await q('SELECT post_id FROM '+prefix+'blog_imports WHERE slug=?',['original']))[0];
    await q('UPDATE '+prefix+'blog_imports SET attributes_json=JSON_SET(attributes_json,\'$.subtitle\',?) WHERE post_id=?',['Legacy subtitle',original.post_id]);
    await q('UPDATE '+prefix+'posts SET subtitle=NULL,public_subtitle=NULL WHERE id=?',[original.post_id]);
    const migrate=require('../lib/CommunitySubtitle').migrate;
    await migrate(Community.sql);
    expect((await Community.post(original.post_id)).subtitle).toBe('Legacy subtitle');
    expect(await (await fetch(base+'/blog/original')).text()).toContain('Legacy subtitle');
    await q("UPDATE "+prefix+"posts SET subtitle='',public_subtitle='' WHERE id=?",[original.post_id]);
    await migrate(Community.sql);
    expect((await Community.post(original.post_id)).subtitle).toBe('');
    expect(await (await fetch(base+'/blog/original')).text()).not.toContain('Legacy subtitle');
  });
  test('only admins can mark published articles for Blog and feeds use the public snapshot',async()=>{
    const user={uid:'moderator',name:'Publisher'};
    const article=await Community.savePost(user,postInput({action:'publish',title:'Featured community article'}));
    const endpoint='/api/community/posts/'+article.id+'/blog';
    await json(endpoint,'PUT',null,{enabled:true},401);
    await json(endpoint,'PUT','alice',{enabled:true},403);
    const draft=await Community.savePost(user,postInput());
    await json('/api/community/posts/'+draft.id+'/blog','PUT','moderator',{enabled:true},400);
    const note=await Community.savePost(user,postInput({kind:'note',action:'publish'}));
    await json('/api/community/posts/'+note.id+'/blog','PUT','moderator',{enabled:true},400);
    expect(await json(endpoint,'PUT','moderator',{enabled:true})).toEqual({isBlog:true});
    await json(endpoint,'PUT','moderator',{enabled:true});
    expect((await Community.blogPosts()).filter(p=>p.url===article.url)).toHaveLength(1);
    expect((await Community.post(article.id)).isBlog).toBe(true);
    for(const url of ['/blog','/blog/feed','/blog/rss']){const response=await fetch(base+url);expect(response.status).toBe(200);const html=await response.text();expect(html).toContain('Featured community article');expect(html).toContain(article.url);expect(html).toContain('Original Blog post');}
    const {chromium}=require('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1200,height:900}});
      await context.addInitScript(()=>{window.quranApiPath=p=>'/api'+p;window.hadithAuth={getToken:async()=>localStorage.getItem('admin-test-user')||'moderator',getUser:async()=>null};});
      await context.route('**/*',route=>{if(route.request().resourceType()==='script'&&!/community(?:-media)?\.js/.test(route.request().url()))return route.abort();return route.continue();});
      const page=await context.newPage();await page.goto(base+article.url);
      const toggle=page.locator('#community-blog-toggle');await toggle.waitFor({state:'visible'});expect(await toggle.isChecked()).toBe(true);
      await toggle.uncheck();await page.waitForFunction(()=>document.getElementById('community-status').textContent==='Article removed from the Blog.');
      await page.reload();await toggle.waitFor({state:'visible'});expect(await toggle.isChecked()).toBe(false);
      await toggle.check();await page.waitForFunction(()=>document.getElementById('community-status').textContent==='Article added to the Blog.');
      await page.route('**/api/community/posts/'+article.id+'/blog',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Please retry.'})}),{times:1});
      await toggle.uncheck();await page.waitForFunction(()=>document.getElementById('community-status').textContent==='Please retry.');expect(await toggle.isChecked()).toBe(true);
      await page.evaluate(()=>localStorage.setItem('admin-test-user','alice'));
      const me=page.waitForResponse(r=>r.url().endsWith('/api/community/me'));await page.reload();expect((await (await me).json()).admin).toBe(false);expect(await page.locator('#community-blog-control').isVisible()).toBe(false);
    }finally{await browser.close();}
    const revised=await Community.savePost(user,postInput({title:'Private revision',markdown:'Unpublished changes',version:article.version}),article.id);
    expect((await Community.blogPosts()).find(p=>p.url===article.url).title).toBe('Featured community article');
    await Community.savePost(user,postInput({action:'unpublish',version:revised.version}),article.id);
    expect((await Community.blogPosts()).some(p=>p.url===article.url)).toBe(false);
    expect(await json(endpoint,'PUT','moderator',{enabled:false})).toEqual({isBlog:false});
  },90000);

  test('article and quick composers upload pasted images and render webpage/video previews', async()=>{
    const {chromium}=require('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1200,height:900}});
      await context.addInitScript(()=>{window.quranApiPath=p=>'/api'+p;window.hadithAuth={getToken:async()=>'alice',getUser:async()=>null};});
      const shared=require('fs').readFileSync(path.join(__dirname,'../public/static/js/script.js'),'utf8');
      const headerHelper=shared.slice(shared.indexOf('function updateFixedHeaderOffset('),shared.indexOf('var fixedHeaderResizeObserver'));
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url.includes('/static/js/script.js'))return route.fulfill({contentType:'application/javascript',body:headerHelper+';new ResizeObserver(()=>updateFixedHeaderOffset()).observe(document.querySelector(".site-navbar"));updateFixedHeaderOffset();'});
        if(!url.startsWith(base))return ['stylesheet','font'].includes(route.request().resourceType())?route.continue():route.abort();
        if(route.request().resourceType()==='script'&&!/community(?:-media)?\.js/.test(url))return route.abort();
        return route.continue();
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      const url='https://example.com/media-test',hash=require('crypto').createHash('sha256').update(url).digest('hex');
      await q(`INSERT INTO ${prefix}link_previews (url_hash,url,title,description) VALUES (?,?,?,?)`,[hash,url,'A useful webpage','A compact webpage preview.']);
      await page.goto(base+'/community/write');
      await page.waitForFunction(()=>document.querySelector('[data-add-image]'));
      await page.locator('#community-title').fill('An illustrated article');
      const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=300;const c=canvas.getContext('2d');c.fillStyle='#e8f4fc';c.fillRect(0,0,600,300);c.fillStyle='#24516f';c.font='28px sans-serif';c.fillText('An image in the article',40,160);return canvas.toDataURL('image/png').split(',')[1];});
      await page.locator('[data-media-editor="markdown"] input[type=file]').setInputFiles({name:'example.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
      await page.waitForFunction(()=>document.getElementById('community-markdown').value.includes('/community/media/')&&!window.communityMediaPending);
      await page.locator('[data-media-editor="markdown"] [data-add-link]').click();
      await page.locator('#community-media-url').fill(url);await page.locator('#community-media-link-form [type=submit]').click();
      await page.locator('[data-media-editor="markdown"] [data-add-video]').click();
      await page.locator('#community-media-url').fill('https://youtu.be/dQw4w9WgXcQ');await page.locator('#community-media-link-form [type=submit]').click();
      await page.locator('#community-preview-button').click();
      await page.waitForFunction(()=>document.querySelector('#community-preview .community-link-card strong')?.textContent==='A useful webpage');
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('#community-preview img')).some(i=>i.src.startsWith('blob:')&&i.naturalWidth>0));
      expect(await page.locator('#community-preview .community-video-play').count()).toBe(1);
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-media-preview-desktop.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-media-preview-mobile.png',fullPage:true});
      await page.locator('#community-preview .community-video-play').click();
      expect(await page.locator('#community-preview iframe').getAttribute('src')).toContain('youtube-nocookie.com/embed/');
      // Navigate without leaving an unsaved-draft confirmation pending.
      page.on('dialog',dialog=>dialog.accept());
      await page.goto(base+'/community');await page.locator('#community-quick-open').click();
      await page.locator('#community-quick-text').evaluate((textarea,png)=>{
        const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],'pasted.png',{type:'image/png'}));
        textarea.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
      },png);
      await page.waitForFunction(()=>document.getElementById('community-quick-text').value.includes('/community/media/')&&!window.communityMediaPending);
      await page.locator('#community-quick-preview-button').click();
      await page.waitForFunction(()=>document.querySelector('#community-quick-preview img')?.naturalWidth>0);
      await page.waitForFunction(()=>(document.querySelector('#community-feed .community-empty') || document.getElementById('community-feed-status').textContent!=='') && !document.getElementById('community-contributors').textContent.includes('Loading contributors'));
      expect(errors).toEqual([]);
    }finally{await browser.close();}
  },90000);

  test('article and note feed cards expose nested discussions without email subscription controls', async()=>{
    const originals=[];
    for(const kind of ['article','note']){
      const post=await Community.savePost({uid:'moderator',name:'Publisher'},postInput({kind,title:'Threaded '+kind,action:'publish'}));
      const comments=await Community.addComment({uid:'bob',name:'Bob'},post.id,{markdown:'Parent '+kind});
      await Community.addComment({uid:'alice',name:'Amina'},post.id,{markdown:'Child '+kind,parentId:comments[0].id});
      originals.push(post);
    }
    const {chromium}=require('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1100,height:900}});
      await context.addInitScript(()=>{window.quranApiPath=p=>'/api'+p;window.hadithAuth={getToken:async()=>'alice',getUser:async()=>null};});
      const shared=require('fs').readFileSync(path.join(__dirname,'../public/static/js/script.js'),'utf8');
      const helper=shared.slice(shared.indexOf('function updateFixedHeaderOffset('),shared.indexOf('var fixedHeaderResizeObserver'));
      await context.route('**/*',route=>{const url=route.request().url();if(url.includes('/static/js/script.js'))return route.fulfill({contentType:'application/javascript',body:helper+';new ResizeObserver(()=>updateFixedHeaderOffset()).observe(document.querySelector(".site-navbar"));updateFixedHeaderOffset();'});if(route.request().resourceType()==='script'&&!/community(?:-media)?\.js/.test(url))return route.abort();return route.continue();});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/community');
      for(const post of originals){
        const card=page.locator('.community-entry[data-activity="post"]').filter({has:page.locator('.community-entry-title',{hasText:post.title})});
        const toggle=card.locator('.community-comments-toggle');await toggle.waitFor();expect(await toggle.textContent()).toBe('View comments (2)');
        await toggle.click();await page.waitForFunction(kind=>Array.from(document.querySelectorAll('.community-thread-reply')).some(el=>el.textContent.includes('Child '+kind)),post.kind);
        expect(await card.locator('.community-thread-reply').count()).toBe(2);
        expect(await card.locator('.community-thread-reply').nth(1).evaluate(el=>parseFloat(el.style.marginInlineStart))).toBeGreaterThan(0);
        await card.locator('.community-thread-reply .community-reply').first().click();
        await card.locator('textarea').fill('New nested '+post.kind);await card.locator('button[type=submit]').click();
        await page.waitForFunction(kind=>Array.from(document.querySelectorAll('.community-thread-reply')).some(el=>el.textContent.includes('New nested '+kind)),post.kind);
        await toggle.click();expect(await card.locator('.community-inline-discussion').isVisible()).toBe(false);
      }
      await page.goto(base+originals[0].url);await page.locator('#community-follow').waitFor();expect(await page.locator('#community-subscribe').count()).toBe(0);
      await page.goto(base+'/community/write');expect(await page.locator('#community-notify').count()).toBe(0);expect(await page.locator('#community-email-option').count()).toBe(0);
      expect(errors).toEqual([]);
    }finally{await browser.close();}
  },90000);

  test('uploaded images stay private until owner publication and link previews use cached metadata', async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
    const upload=uid=>fetch(base+'/api/community/media',{method:'POST',headers:{'Content-Type':'image/png',...(uid?{Authorization:'Bearer '+uid}:{})},body:png});
    expect((await upload(null)).status).toBe(401);
    const response=await upload('moderator');expect(response.status).toBe(201);const media=await response.json();
    expect((await fetch(base+media.url)).status).toBe(404);
    expect((await request(media.url,'GET','moderator')).status).toBe(200);
    expect((await request(media.url,'GET','bob')).status).toBe(404);
    const markdown='![Example image]('+media.url+')';
    const draft=await Community.savePost({uid:'moderator',name:'Publisher'},postInput({markdown}));
    const foreign=await Community.savePost({uid:'bob',name:'Bob'},postInput({markdown}));
    await q(`UPDATE ${prefix}posts SET status='published',public_markdown=markdown,public_title=title WHERE id=?`,[foreign.id]);
    expect((await fetch(base+media.url)).status).toBe(404);
    const published=await Community.savePost({uid:'moderator',name:'Publisher'},postInput({markdown,action:'publish',version:draft.version}),draft.id);
    const publicImage=await fetch(base+media.url);expect(publicImage.status).toBe(200);expect(publicImage.headers.get('content-type')).toContain('image/png');expect(Buffer.from(await publicImage.arrayBuffer())).toEqual(png);
    expect((await Community.feed()).items.find(i=>i.id===draft.id&&i.activity==='post').mediaHtml).toContain(media.url);
    await Community.savePost({uid:'moderator',name:'Publisher'},postInput({markdown,action:'unpublish',version:published.version}),draft.id);
    expect((await fetch(base+media.url)).status).toBe(404);
    const url='https://example.com/article',hash=require('crypto').createHash('sha256').update(url).digest('hex');
    await q(`INSERT INTO ${prefix}link_previews (url_hash,url,title,description) VALUES (?,?,?,?)`,[hash,url,'Example title','Example description']);
    expect(await json('/api/community/link-preview?url='+encodeURIComponent(url),'GET',null)).toMatchObject({title:'Example title',description:'Example description'});
    const preview=await json('/api/community/preview','POST','alice',{markdown:url});
    expect(preview.html).toContain('data-preview-url');
    expect((await json('/api/community/link-preview?url='+encodeURIComponent('https://youtu.be/dQw4w9WgXcQ'),'GET',null)).video.src).toContain('youtube-nocookie.com');
  },90000);

  test('feed reflections retain full text, share votes and threaded replies, and repost live originals', async () => {
    const longText='A full reflection. '.repeat(40)+'Unique ending **complete**';
    const root=(await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,type,user_uid,user_name,text,createdAt) VALUES (7,'bukhari:7','hadith','bob','Bob',?,NOW())`,[longText])).insertId;
    await Community.authorFor({uid:'bob',name:'Bob'});
    let feed=await Community.feed({kind:'comment'});
    expect(feed.items.find(i=>i.id===root && i.activity==='hadiths_comments').html).toContain('Unique ending <strong>complete</strong>');
    const vote='/api/community/votes/hadiths_comments/'+root;
    await json(vote,'PUT',null,{direction:'up'},401);
    expect(await json(vote,'PUT','alice',{direction:'up'})).toMatchObject({likeCount:1,liked:true,dislikeCount:0});
    expect(await json(vote,'PUT','alice',{direction:'down'})).toMatchObject({likeCount:0,liked:false,dislikeCount:1,disliked:true});
    expect((await q(`SELECT up_vote,down_vote FROM ${prefix}hadiths_comments WHERE id=?`,[root]))[0]).toMatchObject({up_vote:0,down_vote:1});
    expect(await json(vote,'PUT','alice',{direction:null})).toMatchObject({likeCount:0,dislikeCount:0});
    const thread='/api/community/discussion/hadiths_comments/'+root;
    await json(thread,'POST',null,{markdown:'Denied'},401);
    await json(thread,'POST','alice',{markdown:'A reply'},201);
    let replies=await json(thread,'GET',null);
    expect(replies.items).toHaveLength(1);
    const child=replies.items[0].id;
    await json('/api/community/discussion/hadiths_comments/'+child,'POST','bob',{markdown:'Nested reply'},201);
    replies=await json(thread,'GET',null);
    expect(replies.items.find(c=>c.id!==child).parentId).toBe(child);
    expect(replies.items.every(c=>!c.author.uid && !c.author.email)).toBe(true);
    expect((await q(`SELECT hadithId,ref_num,parentId FROM ${prefix}hadiths_comments WHERE id=?`,[child]))[0]).toMatchObject({hadithId:7,ref_num:'bukhari:7',parentId:root});
    const repost='/api/community/reposts/hadiths_comments/'+root;
    await json(repost,'PUT',null,{reposted:true},401);
    await json(repost,'PUT','alice',{reposted:true});
    expect(await json(repost,'PUT','alice',{reposted:true})).toMatchObject({repostCount:1,reposted:true});
    feed=await Community.feed({scope:'mine'},{uid:'alice'});
    expect(feed.items.find(i=>i.activity==='repost')).toMatchObject({likeId:root,author:{name:'Bob'},repostedBy:{name:'Amina أحمد'}});
    await q(`UPDATE ${prefix}hadiths_comments SET text='Edited original' WHERE id=?`,[root]);
    expect((await Community.feed({scope:'mine'},{uid:'alice'})).items.find(i=>i.activity==='repost').html).toContain('Edited original');
    await q(`UPDATE ${prefix}hadiths_comments SET deleted=1 WHERE id=?`,[root]);
    expect((await Community.feed({scope:'mine'},{uid:'alice'})).items.some(i=>i.activity==='repost')).toBe(false);
    await json(thread,'GET',null,undefined,404);
    await json(repost,'PUT','alice',{reposted:true},404);
    await json('/api/community/votes/not_a_table/1','PUT','alice',{direction:'up'},400);
    const draft=await Community.savePost({uid:'bob',name:'Bob'},postInput());
    await json('/api/community/reposts/post/'+draft.id,'PUT','alice',{reposted:true},404);
    await json('/api/community/discussion/post/'+draft.id,'GET',null,undefined,404);
  },90000);

  test('native posts and blog threads support mutually exclusive votes and live reposts', async () => {
    const post=await Community.savePost({uid:'moderator',name:'Publisher'},postInput({action:'publish',title:'Interaction article'}));
    const url='/api/community/votes/post/'+post.id;
    expect(await json(url,'PUT','alice',{direction:'down'})).toMatchObject({disliked:true,dislikeCount:1,liked:false});
    expect(await json(url,'PUT','alice',{direction:'up'})).toMatchObject({liked:true,likeCount:1,disliked:false,dislikeCount:0});
    await json('/api/community/discussion/post/'+post.id,'POST','alice',{markdown:'Root reply'},201);
    let replies=await json('/api/community/discussion/post/'+post.id,'GET',null);
    const root=replies.items[0].id;
    await json('/api/community/discussion/comment/'+root,'POST','bob',{markdown:'Child reply'},201);
    replies=await json('/api/community/discussion/comment/'+root,'GET',null);
    expect(replies.items).toHaveLength(1);
    expect(replies.items[0].html).toContain('Child reply');
    await json('/api/community/reposts/post/'+post.id,'PUT','bob',{reposted:true});
    expect((await Community.feed({scope:'mine'},{uid:'bob'})).items.some(i=>i.activity==='repost' && i.likeSource==='post')).toBe(true);
    await json('/api/community/reposts/post/'+post.id,'PUT','bob',{reposted:false});
    expect((await Community.feed({scope:'mine'},{uid:'bob'})).items.some(i=>i.activity==='repost' && i.likeSource==='post')).toBe(false);
    const blog=(await q(`INSERT INTO ${prefix}blog_comments (post_slug,user_uid,user_name,text,createdAt) VALUES ('a-blog','bob','Bob','Blog root',NOW())`)).insertId;
    await json('/api/community/discussion/blog_comments/'+blog,'POST','alice',{markdown:'Blog reply'},201);
    expect((await json('/api/community/discussion/blog_comments/'+blog,'GET',null)).items[0].html).toContain('Blog reply');
    await json('/api/community/votes/blog_comments/'+blog,'PUT','alice',{direction:'down'});
    expect((await q(`SELECT down_vote FROM ${prefix}blog_comments WHERE id=?`,[blog]))[0].down_vote).toBe(1);
  },90000);

  test('legacy blog image migration is idempotent and keeps covers private after unpublishing', async () => {
    const fs=require('fs'),os=require('os'),Import=require('../lib/CommunityBlogImport'),Images=require('../lib/CommunityBlogImages'),Media=require('../lib/CommunityMedia');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blog-images-'));
    try {
      fs.mkdirSync(path.join(dir,'Attachments'));
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
      fs.writeFileSync(path.join(dir,'Attachments','Cover image.png'),png);
      fs.writeFileSync(path.join(dir,'Images.md'),'---\ntitle: Images\npublished: 2020-01-01\ncover: Attachments/Cover image.png\n---\n![[Cover image.png]]\n\n![[Missing note]]');
      await Community.authorFor({uid:'image-author',name:'Image author'});
      const imported=await Import.migrate(dir,'image-author',true),id=imported.imported[0].id;
      const result=await Images.migrate(dir,['hadithunlocked.com'],true,dir);
      expect(result.inserted).toBe(1);expect(result.updated).toBe(1);expect(result.missingNoteEmbeds).toEqual(['Attachments/Missing note']);
      const article=await Community.post(id,{uid:'image-author'},true);
      expect(article.coverUrl).toMatch(/^\/community\/media\/[a-f0-9]{32}$/);expect(article.markdown).toContain(article.coverUrl);expect(article.markdown).not.toContain('![[');
      const mediaId=article.coverUrl.split('/').pop();expect((await Media.image(mediaId,null)).data).toEqual(png);
      expect((await Images.migrate(dir,['hadithunlocked.com'],true,dir)).updated).toBe(0);
      fs.rmSync(dir,{recursive:true,force:true});
      const oldDirectory=global.settings.blog.dir;global.settings.blog.dir=dir;
      try {
        for(const url of ['/blog','/blog/Images','/blog/feed','/blog/rss'])expect((await fetch(base+url)).status).toBe(200);
        expect(await Import.publicUrls()).toContain('/blog/Images');
        const legacy=await fetch(base+'/blog/Attachments/Cover%20image.png',{redirect:'manual'});
        expect(legacy.status).toBe(301);expect(legacy.headers.get('location')).toBe(article.coverUrl);
        const migrated=await fetch(base+'/blog/Attachments/Cover%20image.png');expect(migrated.status).toBe(200);expect(Buffer.from(await migrated.arrayBuffer())).toEqual(png);
        expect((await fetch(base+'/blog/Attachments/missing.png')).status).toBe(404);
      } finally {global.settings.blog.dir=oldDirectory;}

      await q('UPDATE '+prefix+'posts SET status=? WHERE id=?',['draft',id]);
      await expect(Media.image(mediaId,null)).rejects.toMatchObject({status:404});expect((await fetch(base+'/blog/Attachments/Cover%20image.png',{redirect:'manual'})).status).toBe(404);expect((await Media.image(mediaId,{uid:'image-author'})).data).toEqual(png);
      expect(new Date(article.publishedAt).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  test('legacy blog migration preserves URLs dates metadata and public snapshots without duplicates', async () => {
    const fs=require('fs'), Import=require('../lib/CommunityBlogImport');
    const slug='Legacy article العربية', filename=path.join(blogDir,slug+'.md');
    const raw='---\ntitle: Legacy article\nsubtitle: Original description\npublished: 2021-02-03\ncover: Attachments/cover.jpg\nvideo: https://www.youtube.com/watch?v=6bSp_7Ig4_s\n---\n## Original body\n\nOriginal **article** العربية';
    fs.writeFileSync(filename,raw); fs.utimesSync(filename,new Date('2022-04-05T00:00:00Z'),new Date('2022-04-05T00:00:00Z'));
    fs.writeFileSync(path.join(blogDir,'hidden.md'),'---\ntitle: Hidden draft\npublished: 2020-01-01\nhidden: true\n---\nPrivate draft');
    const author=await Community.authorFor({uid:'import-author',name:'Blog author'});
    try {
      const dry=await Import.migrate(blogDir,'import-author'); expect(dry.pending.some(p=>p.slug===slug)).toBe(true); expect(dry.hidden).toContain('hidden');
      const result=await Import.migrate(blogDir,'import-author',true), imported=result.imported.find(p=>p.slug===slug);
      const before=await (await fetch(base+Import.url(slug))).text();
      expect((await Import.migrate(blogDir,'import-author',true)).imported).toHaveLength(0);
      const article=await Community.post(imported.id); expect(article.url).toBe(Import.url(slug)); expect(new Date(article.publishedAt).toISOString()).toBe('2021-02-03T00:00:00.000Z'); expect(article.isBlog).toBe(true);
      expect(article.subtitle).toBe('Original description'); expect(article.publicationDate).toBe('2021-02-03'); expect(article.coverUrl).toBe('/blog/Attachments/cover.jpg'); expect(article.mediaHtml).toContain('/blog/Attachments/cover.jpg'); expect(article.mediaHtml).toContain('Original description'); expect(article.mediaHtml).toContain('6bSp_7Ig4_s');
      const preview=await require('../lib/CommunityMedia').preview(base+article.url); expect(preview.title).toBe('Legacy article'); expect(preview.image).toBe(base+'/blog/Attachments/cover.jpg');
      const mine=await Community.feed({scope:'mine'},{uid:'import-author'}); expect(new Date(mine.items.find(i=>i.id===imported.id).activityAt).toISOString()).toBe('2021-02-03T00:00:00.000Z');
      const feed=await Community.feed({author:author.handle}); expect(feed.items.find(i=>i.id===imported.id).url).toBe(article.url);
      fs.unlinkSync(filename);
      const after=await (await fetch(base+article.url)).text();
      const parse=require('cheerio').load;
      for(const selector of ['title','link[rel=canonical]','meta[name=description]','.blog-post article','#blog-comments']) expect(parse(after)(selector).toString()).toBe(parse(before)(selector).toString());
      const browser=await require('playwright').chromium.launch({channel:'chrome',headless:true});
      try {
        const page=await browser.newPage({viewport:{width:390,height:844}});
        await page.addInitScript(()=>{window.quranApiPath=v=>'/api'+v;window.hadithAuth={getToken:async()=>'alice',getUser:async()=>null};});
        const ownerPost=await Community.post(imported.id,{uid:'import-author'},true);
        await page.route('**/*',route=>{
          const request=route.request(),url=request.url();
          if(url.includes('/api/community/posts/'+imported.id+'?edit=1'))return route.fulfill({json:{post:ownerPost}});
          if(request.resourceType()==='script'&&!url.includes('/static/js/community.js'))return route.abort();
          if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="gray"/></svg>'});
          return route.continue();
        });
        await page.goto(base+'/community/write?post='+imported.id);
        await page.waitForSelector('#community-editor-cover img');
        expect(await page.locator('#community-subtitle').inputValue()).toBe('Original description');
        await page.locator('#community-subtitle').fill('An edited subtitle');
        expect(await page.locator('#community-editor-cover img').getAttribute('src')).toBe('/blog/Attachments/cover.jpg');
        await page.locator('#community-markdown').fill('@[toc]\n\n# Overview\n\n## العربية');
        await page.locator('#community-preview-button').click();
        await page.waitForSelector('#community-preview .community-toc a');
        expect(await page.locator('#community-preview-subtitle').textContent()).toBe('An edited subtitle');
        expect(await page.locator('#community-preview .community-toc a').count()).toBe(2);
        expect(await page.locator('#community-preview').textContent()).not.toContain('@[toc]');
      } finally {await browser.close();}
      const redirect=await fetch(base+'/community/@'+author.handle+'/'+imported.id,{redirect:'manual'});expect(redirect.status).toBe(301);expect(redirect.headers.get('location')).toBe(article.url);
      const rss=await (await fetch(base+'/blog/rss')).text();expect(rss.match(/<title>Legacy article<\/title>/g)).toHaveLength(1);
      expect((await q('SELECT COUNT(*) n FROM '+prefix+'email_outbox WHERE post_id=?',[imported.id]))[0].n).toBe(0);
      await q('UPDATE '+prefix+'posts SET markdown=?,title=? WHERE id=?',['Unpublished edits','Private title',imported.id]);
      expect(await (await fetch(base+article.url)).text()).not.toContain('Unpublished edits');
      await q('UPDATE '+prefix+'posts SET status=? WHERE id=?',['hidden',imported.id]); fs.writeFileSync(filename,raw);
      expect((await fetch(base+article.url)).status).toBe(404);
      expect(await (await fetch(base+'/blog/rss')).text()).not.toContain('<title>Legacy article</title>');
    } finally { for(const name of [filename,path.join(blogDir,'hidden.md')]) if(fs.existsSync(name))fs.unlinkSync(name); }
  });
  test('profile controls open edit and people modals with private follower lists', async () => {
    const alice = await Community.authorFor({uid:'alice',name:'Amina'});
    const bob = await Community.authorFor({uid:'bob',name:'Bob'});
    await Community.follow({uid:'bob',name:'Bob'},alice.handle,true,false);
    await Community.follow({uid:'alice',name:'Amina'},bob.handle,true,false);
    await json('/api/community/me/followers','GET',null,undefined,401);
    const followers = await json('/api/community/me/followers','GET','alice');
    expect(followers.items).toEqual(expect.arrayContaining([expect.objectContaining({handle:bob.handle})]));
    expect(JSON.stringify(followers)).not.toMatch(/private.test|user_uid|follower_uid/);
    const browser = await require('playwright').chromium.launch({channel:'chrome',headless:true});
    try {
      const context = await browser.newContext({viewport:{width:390,height:844}});
      await context.addInitScript(() => { window.quranApiPath=v=>'/api'+v; window.hadithAuth={getToken:async()=>'alice',getUser:async()=>null}; });
      const sharedScript=require('fs').readFileSync(path.join(__dirname,'../public/static/js/script.js'),'utf8');
      const headerHelper=sharedScript.slice(sharedScript.indexOf('function updateFixedHeaderOffset('),sharedScript.indexOf('var fixedHeaderResizeObserver'));
      await context.route('**/*', route => {
        if (route.request().url().includes('/static/js/script.js')) return route.fulfill({contentType:'application/javascript',body:headerHelper+';new ResizeObserver(()=>updateFixedHeaderOffset()).observe(document.querySelector(".site-navbar"));updateFixedHeaderOffset();'});
        if (route.request().resourceType()==='script' && !route.request().url().includes('/static/js/community.js')) return route.abort();
        if (route.request().resourceType()==='image') return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(base+'/community/mine');
      await page.waitForFunction(()=>!document.getElementById('community-wall-profile').hidden);
      expect(await page.locator('.community-aside #community-profile-form').count()).toBe(0);
      await page.locator('#community-edit-profile').click();
      expect(await page.locator('#community-profile-dialog').isVisible()).toBe(true);
      await page.locator('#community-bio').fill('Updated through the profile modal');
      await page.locator('#community-profile-form [type=submit]').click();
      await page.waitForFunction(()=>document.getElementById('community-wall-bio').textContent==='Updated through the profile modal');
      expect(await page.locator('#community-profile-dialog').isVisible()).toBe(false);
      await page.locator('#community-wall-stats button').nth(0).click();
      await page.waitForSelector('#community-followers a');
      expect(await page.locator('#community-followers a').first().getAttribute('href')).toBe('/community/@'+bob.handle);
      await page.keyboard.press('Escape');
      expect(await page.locator('#community-people-dialog').isVisible()).toBe(false);
      await page.locator('#community-wall-stats button').nth(1).click();
      expect(await page.locator('#community-subscriptions').isVisible()).toBe(true);
      expect(await page.locator('#community-subscriptions').textContent()).toContain('Unfollow');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.locator('#community-people-close').click();
      expect(await page.locator('#community-people-dialog').isVisible()).toBe(false);
    } finally { await browser.close(); }
  },60000);
  test('handles support periods and underscores in profiles, public feeds, and follows', async () => {
    const user = {uid:'punctuated-handle',name:'Handle test'};
    const author = await Community.saveProfile(user, {name:user.name,handle:'7.Writer_test'});
    expect(author.handle).toBe('7.writer_test');
    expect((await fetch(base+'/community/@7.writer_test')).status).toBe(200);
    expect((await Community.feed({author:author.handle})).items).toEqual([]);
    await Community.follow({uid:'handle-follower',name:'Follower'},author.handle,true,false);
    expect((await Community.relationship({uid:'handle-follower'},author.handle)).following).toBe(true);
    await expect(Community.saveProfile({uid:'handle-duplicate',name:'Duplicate'}, {name:'Duplicate',handle:'7.WRITER_TEST'})).rejects.toMatchObject({status:409});
    for (const handle of ['bad/name','bad name','bad@name']) {
      await expect(Community.saveProfile({uid:'handle-invalid',name:'Invalid'}, {name:'Invalid',handle})).rejects.toMatchObject({status:400});
    }
  });
  test('merged profile handles resolve to one author and preserve follow targets', async () => {
    const author=await Community.authorFor({uid:'canonical-user',name:'Merged author'});
    await q(`INSERT INTO ${prefix}author_aliases (handle,author_uid) VALUES ('old-author','canonical-user')`);
    expect((await Community.profile('old-author')).handle).toBe(author.handle);
    const response=await fetch(base+'/community/@old-author',{redirect:'manual'});
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/community/@'+author.handle);
    await Community.follow({uid:'alias-follower',name:'Follower'},'old-author',true,false);
    expect((await Community.relationship({uid:'alias-follower'},author.handle)).following).toBe(true);
    expect((await Community.feed({author:'old-author'})).items).toEqual([]);
  });
  test('unauthenticated writes and private feeds are denied; profiles expose no email or UID', async () => {
    await json('/api/community/posts','POST',null,postInput(),401);
    await json('/api/community/me','GET',null,undefined,401);
    await json('/api/community/feed?scope=mine','GET',null,undefined,401);
    const me = await json('/api/community/me','GET','alice'); expect(me.author.name).toBe('Amina أحمد');
    expect((await json('/quran/api/community/me','GET','alice')).author.handle).toBe(me.author.handle);
    await json('/api/community/feed?author[x]=1','GET',null,undefined,400);
    const author = await json('/api/community/profile','PUT','alice',{ name:'Amina أحمد', handle:'amina', bio:'Learning together العربية' }); expect(author.author.handle).toBe('amina');
    const profile = await request('/community/@amina','GET',null); expect(profile.status).toBe(200);
    const html = await profile.text(); expect(html).toContain('Amina أحمد'); expect(html).not.toContain('alice@private.test');
  });
  test('private drafts cannot be read publicly or edited through a forged owner; first publication awaits review', async () => {
    const saved = await json('/api/community/posts','POST','alice',postInput({author_uid:'bob'}),201); firstId=saved.post.id;
    expect(saved.post.status).toBe('draft');
    await json('/api/community/posts/'+firstId,'GET',null,undefined,404);
    await json('/api/community/posts/'+firstId+'?edit=1','GET','bob',undefined,404);
    await json('/api/community/posts/'+firstId,'PUT','bob',postInput({version:1,action:'publish'}),404);
    const pending=await json('/api/community/posts/'+firstId,'PUT','alice',postInput({version:1,action:'publish'})); expect(pending.post.status).toBe('pending');
    expect((await json('/api/community/feed','GET',null)).items).toHaveLength(0);
    await json('/api/community/posts/'+firstId,'GET','expired',undefined,404);
    await json('/api/community/feed?scope=mine','GET','expired',undefined,401);
    await json('/api/community/posts','POST','expired',postInput(),401);
    await json('/api/community/posts/'+firstId+'/moderation','POST','alice',{action:'approve',version:2},403);
    await json('/api/community/posts/'+firstId+'/moderation','POST','moderator',{action:'approve',version:1},409);
    await json('/api/community/posts/'+firstId+'/moderation','POST','moderator',{action:'approve',version:2});
    expect((await json('/api/community/posts/'+firstId,'GET',null)).post.html).toContain('Original published body');
    expect((await json('/api/community/posts/'+firstId,'GET','expired')).post.html).toContain('Original published body');
    await json('/api/community/posts/'+firstId+'/comments','GET','expired');
    await json('/api/community/feed','GET','expired');
  });
  test('stale edits are rejected; saving a new draft does not change the published snapshot', async () => {
    const current=(await json('/api/community/posts/'+firstId+'?edit=1','GET','alice')).post;
    const saved=await json('/api/community/posts/'+firstId,'PUT','alice',postInput({version:current.version,markdown:'New private draft'}));
    await json('/api/community/posts/'+firstId,'PUT','alice',postInput({version:current.version,markdown:'Overwrite'}),409);
    const published=(await json('/api/community/posts/'+firstId,'GET',null)).post; expect(published.html).toContain('Original published body'); expect(published.html).not.toContain('New private draft');
    const updated=await json('/api/community/posts/'+firstId,'PUT','alice',postInput({version:saved.post.version,markdown:'Updated public body',action:'publish'})); expect(updated.post.status).toBe('published');
    expect((await json('/api/community/posts/'+firstId,'GET',null)).post.html).toContain('Updated public body');
    const revisions=await q(`SELECT version FROM ${prefix}revisions WHERE post_id=?`,[firstId]); expect(revisions.length).toBe(4);
  });
  test('following and email subscriptions are independent, and delivery rechecks opt-out', async () => {
    await json('/api/community/authors/amina/follow','PUT','bob',{following:true,email:false});
    expect((await json('/api/community/feed?scope=following','GET','bob')).items.some(p=>p.id===firstId)).toBe(true);
    expect((await json('/api/community/feed?scope=following','GET','mallory')).items).toHaveLength(0);
    await json('/api/community/authors/amina/follow','PUT','alice',{following:true,email:false},400);
    const noEmail=await json('/api/community/posts','POST','alice',postInput({action:'publish',notifyEmail:true,title:'No subscriber email'}),201);
    expect(await q(`SELECT * FROM ${prefix}email_outbox WHERE post_id=?`,[noEmail.post.id])).toHaveLength(0);
    await json('/api/community/authors/amina/follow','PUT','bob',{following:true,email:true});
    const queued=await json('/api/community/posts','POST','alice',postInput({action:'publish',notifyEmail:true,title:'Email me'}),201);
    expect(await q(`SELECT * FROM ${prefix}email_outbox WHERE post_id=?`,[queued.post.id])).toHaveLength(1);
    const token=(await q(`SELECT unsubscribe_token FROM ${prefix}follows WHERE follower_uid='bob'`))[0].unsubscribe_token;
    expect((await request('/community/unsubscribe/'+token,'GET',null)).status).toBe(200);
    expect((await json('/api/community/authors/amina/relationship','GET','bob')).email).toBe(true);
    expect((await request('/community/unsubscribe/'+token,'POST',null,{'List-Unsubscribe':'One-Click'})).status).toBe(200);
    expect(await json('/api/community/authors/amina/relationship','GET','bob')).toEqual({following:true,email:false});
    const sendMail=jest.fn(); const result=await require('../lib/CommunityMail').deliverBatch({transport:{sendMail}}); expect(result.skipped).toBe(1); expect(sendMail).not.toHaveBeenCalled();
    await json('/api/community/authors/amina/follow','PUT','bob',{following:true,email:true});
    const emailed=await json('/api/community/posts','POST','alice',postInput({action:'publish',notifyEmail:true,title:'Mail test'}),201);
    const delivery=await require('../lib/CommunityMail').deliverBatch({transport:{sendMail:sendMail.mockResolvedValue({})}}); expect(delivery.sent).toBe(1); expect(sendMail.mock.calls[0][0].headers['List-Unsubscribe']).toContain('/community/unsubscribe/');
    expect((await require('../lib/CommunityMail').deliverBatch({transport:{sendMail}})).sent).toBe(0);
  });
  test('notebook copying is owner-only and returns a public-safe body without private frontmatter', async () => {
    const copy=await json('/api/community/notebook-copy?source=item%3A42','GET','alice'); expect(copy.markdown).toContain('Private notebook body'); expect(copy.markdown).not.toMatch(/Secret|metadata|data-notebook/);
    await json('/api/community/notebook-copy?source=item%3A42','GET','bob',undefined,404);
  });
  test('replies stay inside their post, deleted comments preserve threads, reports reach moderators, and hiding removes public access', async () => {
    const result=await json('/api/community/posts/'+firstId+'/comments','POST','bob',{markdown:'First comment العربية'},201); const comment=result.comments[0];
    const other=(await json('/api/community/posts','POST','alice',postInput({action:'publish'}),201)).post;
    await json('/api/community/posts/'+other.id+'/comments','POST','alice',{markdown:'Wrong parent',parentId:comment.id},400);
    await json('/api/community/posts/'+firstId+'/comments','POST','alice',{markdown:'A reply',parentId:comment.id},201);
    await json('/api/community/comments/'+comment.id,'DELETE','mallory',undefined,404);
    await json('/api/community/comments/'+comment.id,'DELETE','bob');
    const thread=await json('/api/community/posts/'+firstId+'/comments','GET',null); expect(thread.comments[0].deleted).toBe(true); expect(thread.comments[1].parentId).toBe(comment.id);
    await json('/api/community/posts/'+firstId+'/report','POST','bob',{reason:'Please review this post'});
    expect((await json('/api/community/moderation','GET','moderator')).reports).toHaveLength(1);
    await json('/api/community/posts/'+firstId+'/moderation','POST','moderator',{action:'hide'});
    await json('/api/community/posts/'+firstId,'GET',null,undefined,404);
    await json('/api/community/posts/'+firstId+'/comments','GET',null,undefined,404);
    const hidden=(await json('/api/community/posts/'+firstId+'?edit=1','GET','alice')).post;
    await json('/api/community/posts/'+firstId,'PUT','alice',postInput({version:hidden.version,action:'publish'}),403);
    expect((await json('/api/community/feed','GET',null)).items.some(p=>p.id===firstId && p.activity==='post')).toBe(false);
  });
  test('desktop and mobile publishing, preview, follow controls, and personal wall work in a browser', async () => {
    await Community.saveProfile({uid:'alice',name:'Amina أحمد'}, {name:'Amina أحمد',handle:'amina'});
    await q(`UPDATE ${prefix}authors SET trusted=1 WHERE uid='alice'`);
    await require('../lib/UserAvatar').remember({uid:'alice',email:'alice@private.test',photo:'https://avatar.test/photo.png'});
    await q(`INSERT INTO ${prefix}hadiths_likes (hadithId,ref_num,type,user_uid,user_name,createdAt) VALUES (6007,'bukhari:6007','hadith','alice','Amina',NOW(3))`);
    await Community.savePost({uid:'moderator',name:'Community contributor'}, postInput({action:'publish',title:'Contributor article'}));
    const browserReflection=(await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,type,user_uid,user_name,text,createdAt) VALUES (11,'bukhari:11','hadith','moderator','Community contributor',?,NOW())`,['Full reflection. '.repeat(35)+'Visible final sentence.'])).insertId;
    const browser=await require('playwright').chromium.launch({channel:'chrome',headless:true});
    try {
      const context=await browser.newContext({viewport:{width:1280,height:900}});
      await context.addInitScript(() => {
        window.quranApiPath=value=>'/api'+value;
        window.hadithAuth={getToken:async()=>localStorage.getItem('community-test-uid') || null,getUser:async()=>null};
      });
      const sharedScript=require('fs').readFileSync(path.join(__dirname,'../public/static/js/script.js'),'utf8');
      const headerOffsetHelper=sharedScript.slice(sharedScript.indexOf('function updateFixedHeaderOffset('),sharedScript.indexOf('var fixedHeaderResizeObserver'));
      await context.route('**/*', route=> {
        const request=route.request(), url=request.url();
        if (url.includes('/static/js/script.js')) return route.fulfill({contentType:'application/javascript',body:headerOffsetHelper+';new ResizeObserver(()=>updateFixedHeaderOffset()).observe(document.querySelector(".site-navbar"));updateFixedHeaderOffset();'});
        if (request.resourceType()==='script' && !url.includes('/static/js/community.js') && !url.includes('/static/js/community-media.js') && !url.includes('/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js')) return route.abort();
        if (url.includes('avatar.test/missing')) return route.fulfill({status:404,body:''});
        if (url.includes('avatar.test/') || url.includes('gravatar.com/avatar/')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#2c9be5"/></svg>'});
        if (request.resourceType()==='image' && !url.includes('/static/') && !url.includes('/community/media/')) return route.abort();
        return route.continue();
      });
      const page=await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/community/write');
      await page.evaluate(()=>localStorage.setItem('community-test-uid','alice'));
      await page.reload();
      expect(await page.locator('#community-kind').inputValue()).toBe('article');
      expect(await page.locator('#community-markdown').getAttribute('placeholder')).toContain('## A section heading');
      await page.screenshot({path:'/tmp/community-article-editor-desktop.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:'/tmp/community-article-editor-mobile.png',fullPage:true});
      await page.setViewportSize({width:1280,height:900});
      await page.locator('#community-title').fill('Browser article العربية');
      await page.locator('#community-markdown').fill('## العربية\n\nA **browser-tested** reflection.');
      expect(await page.locator('#community-publish').isDisabled()).toBe(true);
      await page.locator('#community-preview-button').click();
      await page.waitForFunction(()=>!document.getElementById('community-publish').disabled);
      expect(await page.locator('#community-preview strong').textContent()).toBe('browser-tested');
      await page.locator('#community-publish').click();
      await page.waitForFunction(()=>document.getElementById('community-status').textContent==='Your article is public.');
      expect(await page.locator('#community-publish').isDisabled()).toBe(true);
      const savedId=new URL(page.url()).searchParams.get('post'); expect(savedId).toBeTruthy();
      await page.goto(base+'/community/@amina/'+savedId);
      await page.waitForFunction(()=>!document.getElementById('community-edit-post').hidden);
      expect(await page.locator('.community-reading .notebook-markdown').first().textContent()).toContain('browser-tested');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-desktop.png',fullPage:true});
      await page.locator('.community-tabs a[href="/community"]').click();
      await page.waitForFunction(()=>document.getElementById('community-quick-name').textContent==='Amina أحمد');
      expect(await page.locator('#community-prompt-avatar img').getAttribute('src')).toBe('https://avatar.test/photo.png');
      await page.locator('#community-prompt-avatar img').evaluate(img=>img.src='https://avatar.test/missing.png');
      await page.waitForFunction(()=>document.querySelector('#community-prompt-avatar img')?.src.includes('gravatar.com/avatar/'));
      await page.locator('#community-contributors .community-contributor-follow').first().waitFor();
      const contributorToggle=page.locator('#community-contributors .community-contributor-follow').first();
      expect(await contributorToggle.textContent()).toBe('Follow');
      await contributorToggle.click();
      await page.waitForFunction(()=>document.querySelector('#community-contributors .community-contributor-follow').textContent==='Unfollow');
      await contributorToggle.click();
      await page.waitForFunction(()=>document.querySelector('#community-contributors .community-contributor-follow').textContent==='Follow');
      expect(await page.locator('.community-tabs a').count()).toBe(5);
      expect(await page.locator('.community-tabs a[href="/blog"]').isVisible()).toBe(true);
      expect(await page.locator('#community-quick-post').isDisabled()).toBe(true);
      await page.locator('#community-quick-open').click();
      expect(await page.locator('#community-quick-text').evaluate(el=>el===document.activeElement)).toBe(true);
      await page.locator('#community-quick-text').fill('A quick **reflection**. الحمد لله');
      await page.keyboard.press('Escape');
      expect(await page.locator('#community-quick-dialog').isVisible()).toBe(false);
      await page.locator('#community-quick-open').click();
      expect(await page.locator('#community-quick-text').inputValue()).toContain('A quick');
      await page.screenshot({path:'/tmp/community-composer-desktop.png'});
      await page.locator('#community-quick-preview-button').click();
      await page.locator('#community-quick-preview').waitFor({state:'visible'});
      expect(await page.locator('#community-quick-preview strong').textContent()).toBe('reflection');
      await page.route('**/api/community/posts', route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Please try again.'})}),{times:1});
      await page.locator('#community-quick-post').click();
      await page.waitForFunction(()=>document.getElementById('community-quick-status').textContent==='Please try again.');
      expect(await page.locator('#community-quick-text').inputValue()).toContain('A quick');
      await page.locator('#community-quick-post').click();
      await page.waitForFunction(()=>document.getElementById('community-quick-status').textContent.includes('Your note is published.'));
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('A quick reflection. الحمد لله'));
      expect(await page.locator('#community-quick-text').inputValue()).toBe('');
      expect(await page.locator('#community-quick-post').isDisabled()).toBe(true);
      expect(await page.locator('[data-kind="note"] .community-entry-title').count()).toBe(0);
      const geometry=await page.evaluate(()=>({header:document.querySelector('.site-navbar').getBoundingClientRect().bottom,heading:document.querySelector('.community-heading').getBoundingClientRect().top}));
      expect(geometry.heading).toBeGreaterThanOrEqual(geometry.header);
      const feedLike=page.locator('#community-feed button.community-like').first();
      await feedLike.click();
      await page.waitForFunction(()=>document.querySelector('#community-feed button.community-like').getAttribute('aria-pressed')==='true');
      await feedLike.click();
      await page.waitForFunction(()=>document.querySelector('#community-feed button.community-like').getAttribute('aria-pressed')==='false');
      const reaction=page.locator('#community-feed [data-kind=like]').first();
      expect(await reaction.locator('h2').count()).toBe(0);
      expect((await reaction.boundingBox()).height).toBeLessThan(72);
      await reaction.screenshot({path:'/tmp/community-reaction-compact.png'});
      await page.evaluate(()=>scrollTo(0,0));
      const railGeometry=await page.evaluate(()=>({rail:document.querySelector('.community-aside').getBoundingClientRect().top,header:document.querySelector('.site-navbar').getBoundingClientRect().bottom}));
      expect(railGeometry.rail-railGeometry.header).toBeGreaterThanOrEqual(0);
      expect(railGeometry.rail-railGeometry.header).toBeLessThan(20);
      const reflection=page.locator('.community-entry[data-activity="hadiths_comments"]').filter({hasText:'Visible final sentence.'}).first();
      expect(await reflection.locator('.community-reflection-body').textContent()).toContain('Visible final sentence.');
      expect(await reflection.locator('.community-entry-title').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(22);
      await reflection.locator('.community-dislike').click();
      await page.waitForFunction(id=>document.querySelector('.community-entry-actions[data-source="hadiths_comments"][data-target="'+id+'"] .community-dislike')?.getAttribute('aria-pressed')==='true',browserReflection);
      await reflection.locator('.community-like').click();
      await page.waitForFunction(id=>document.querySelector('.community-entry-actions[data-source="hadiths_comments"][data-target="'+id+'"] .community-dislike')?.getAttribute('aria-pressed')==='false',browserReflection);
      await reflection.locator('.community-reply').first().click();
      await reflection.locator('textarea').fill('Browser threaded reply');
      await reflection.locator('button[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('.community-thread-reply')?.textContent.includes('Browser threaded reply'));
      await reflection.locator('.community-thread-reply .community-reply').click();
      await reflection.locator('textarea').fill('Nested browser reply');
      await reflection.locator('button[type="submit"]').click();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.community-thread-reply')).some(el=>el.textContent.includes('Nested browser reply')));
      await reflection.locator(':scope > .community-entry-actions .community-repost').click();
      await page.waitForFunction(id=>document.querySelector('.community-entry-actions[data-source="hadiths_comments"][data-target="'+id+'"] .community-repost')?.getAttribute('aria-pressed')==='true',browserReflection);
      await reflection.screenshot({path:'/tmp/community-threaded-reflection.png'});
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-feed-desktop.png',fullPage:true});
      await page.evaluate(async()=>{
        document.querySelector('.community-aside').style.minHeight='600px';
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        scrollTo(0,document.documentElement.scrollHeight);
      });
      await page.waitForFunction(()=>document.querySelector('body > footer').getBoundingClientRect().top < innerHeight);
      await page.waitForFunction(()=>document.querySelector('.community-aside').getBoundingClientRect().bottom <= document.querySelector('body > footer').getBoundingClientRect().top - 11);
      await page.screenshot({path:'/tmp/community-footer-desktop.png'});

      await page.goto(base+'/community/@amina/'+savedId);

      await page.evaluate(()=>localStorage.setItem('community-test-uid','mallory'));
      await page.setViewportSize({width:390,height:844}); await page.reload();
      await page.locator('#community-follow').click();
      await page.waitForFunction(()=>document.getElementById('community-follow').textContent.includes('Unfollow'));
      expect(await page.locator('#community-subscribe').count()).toBe(0);
      await page.locator('#community-comment-text').fill('A mobile reflection');
      await page.locator('#community-comment-form [type=submit]').click();
      await page.waitForFunction(()=>document.getElementById('community-comments').textContent.includes('A mobile reflection'));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-mobile.png',fullPage:true});
      await page.goto(base+'/community/mine');
      await page.waitForFunction(()=>!document.getElementById('community-wall-profile').hidden);
      await page.locator('#community-quick-open').click();
      await page.locator('#community-quick-text').fill('A first mobile note');
      await page.screenshot({path:'/tmp/community-composer-mobile.png'});
      await page.locator('#community-quick-post').click();
      await page.waitForFunction(()=>document.getElementById('community-quick-status').textContent.includes('Submitted for review.'));
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('A first mobile note'));
      expect(await page.locator('#community-quick-dialog').isVisible()).toBe(false);
      await page.locator('#community-quick-open').click();
      await page.locator('#community-quick-text').fill('Unsaved private thought');
      await page.evaluate(()=>{localStorage.removeItem('community-test-uid');document.dispatchEvent(new CustomEvent('hadithAuthChanged'));});
      await page.waitForFunction(()=>document.getElementById('community-quick-text').value==='');
      expect(await page.locator('#community-feed').textContent()).not.toContain('A first mobile note');

      await page.evaluate(()=>localStorage.setItem('community-test-uid','alice'));
      await page.reload();
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('Browser article'));
      expect(await page.locator('#community-wall-handle').textContent()).toBe('@amina');
      expect(await page.locator('#community-wall-stats').textContent()).toMatch(/followers?.*following.*posts?.*reflections/);
      await page.goto(base+'/community/@amina');
      await page.waitForURL(base+'/community/mine');
      await page.waitForFunction(()=>!document.getElementById('community-wall-profile').hidden);
      expect(await page.locator('#community-quick-open').isVisible()).toBe(true);
      await page.waitForFunction(()=>document.querySelector('#community-contributors a[href="/community/@amina"]'));
      const ownRecommendation=page.locator('.community-contributor').filter({has:page.locator('a[href="/community/@amina"]')});
      expect(await ownRecommendation.locator('button').count()).toBe(0);

      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-my-wall-mobile.png',fullPage:true});
      expect(await page.locator('.community-tabs [aria-current=page]').textContent()).toContain('Me');
      await page.screenshot({path:'/tmp/community-section-menu-mobile.png',fullPage:true});
      await page.locator('.community-tabs a[href="/notebook"]').click();
      expect(await page.locator('#personal-notebook > nav').count()).toBe(0);
      expect(await page.locator('.community-tabs [aria-current=page]').textContent()).toContain('My Notebook');
      await page.locator('.community-tabs a[href="/community"]').click();
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('A quick reflection'));
      await page.waitForLoadState('load');
      await page.screenshot({path:'/tmp/community-feed-mobile.png',fullPage:true});
      const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,items:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right}))}));
      if(overflow.width>overflow.viewport) console.log('Mobile overflow',overflow);
      expect(overflow.width).toBeLessThanOrEqual(overflow.viewport);

      await page.locator('.community-tabs a[href="/blog"]').click();
      expect(await page.locator('.community-tabs [aria-current=page]').textContent()).toBe('Blog');
      expect(await page.locator('.site-navbar .nav-link.active[href="/community"]').count()).toBeGreaterThan(0);
      await page.waitForLoadState('load');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.locator('.community-tabs a[href="/community"]').click();
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('A quick reflection'));
      await page.addInitScript(() => { window.hadithAuth = {getUser: async () => null, getToken: async () => { throw new Error('Session unavailable'); }}; });
      await page.goto(base+'/community/@amina/'+savedId);
      await page.waitForFunction(()=>document.getElementById('community-comments').textContent.includes('A mobile reflection'));
      expect(await page.locator('#community-status').textContent()).toBe('');
      expect(await page.locator('#community-edit-post').isVisible()).toBe(false);
      await page.goto(base+'/community/@amina');
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('Browser article'));
      expect(await page.locator('#community-status').textContent()).toBe('');
      await page.goto(base+'/community');
      await page.waitForFunction(()=>document.getElementById('community-feed').textContent.includes('A quick reflection'));
      expect(await page.locator('#community-status').textContent()).toBe('');
      const requestedOffsets=[]; let failNextPage=true;
      await page.route('**/api/community/feed?*', route => {
        const offset=Number(new URL(route.request().url()).searchParams.get('offset') || 0); requestedOffsets.push(offset);
        if(offset===20 && failNextPage) { failNextPage=false; return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary feed error'})}); }
        const items=Array.from({length:Math.min(20,45-offset)},(_,i)=>({id:1000+offset+i,activity:'post',kind:'note',title:'Note',excerpt:'Paged reflection '+(offset+i),author:{handle:'amina',name:'Amina'},url:'/community/@amina/'+savedId,activityAt:new Date().toISOString()}));
        return route.fulfill({contentType:'application/json',body:JSON.stringify({items,hasMore:offset+20<45,offset:offset+20})});
      });
      await page.reload();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===20);
      expect(requestedOffsets).toEqual([0]);
      await page.locator('#community-feed-sentinel').scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>document.getElementById('community-more').textContent==='Try again');
      expect(await page.locator('#community-feed .community-entry').count()).toBe(20);
      await page.locator('#community-more').click();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===40);
      await page.locator('#community-feed-sentinel').scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===45);
      expect(requestedOffsets).toEqual([0,20,20,40]);
      expect(await page.locator('#community-feed-status').textContent()).toContain('caught up');
      await page.unroute('**/api/community/feed?*');
      let releaseNext;
      const nextPageGate=new Promise(resolve=>{releaseNext=resolve;});
      await page.route('**/api/community/feed?*', async route=>{
        const offset=Number(new URL(route.request().url()).searchParams.get('offset') || 0);
        if(offset===20) await nextPageGate;
        const items=Array.from({length:Math.min(20,32-offset)},(_,i)=>({id:2000+offset+i,activity:offset+i>=25?'hadiths_comments_like':'hadith_like',kind:'like',title:'Liked bukhari:'+i,excerpt:'',author:{handle:'amina',name:'Amina'},url:'/community/@amina/'+savedId,activityAt:new Date().toISOString()}));
        return route.fulfill({contentType:'application/json',body:JSON.stringify({items,hasMore:offset+20<32,offset:offset+20})});
      });
      await page.reload();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===20);
      expect(await page.locator('#community-feed .community-entry:visible').count()).toBe(10);
      const extra=page.locator('.community-reaction-overflow').first();
      expect(await extra.locator('summary').textContent()).toContain('Show 10 more activities');
      await extra.locator('summary').click();
      expect(await page.locator('#community-feed .community-entry:visible').count()).toBe(20);
      releaseNext();
      await page.locator('#community-more').click();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===32);
      expect(await extra.getAttribute('open')).not.toBeNull();
      expect(await page.locator('.community-reaction-overflow').count()).toBe(1);
      expect(await extra.locator('summary').textContent()).toContain('Show 15 more activities');
      await extra.locator('summary').click();
      expect(await page.locator('#community-feed .community-entry:visible').count()).toBe(17);
      await page.unroute('**/api/community/feed?*');
      const longRunOffsets=[];
      await page.route('**/api/community/feed?*', route=>{
        const offset=Number(new URL(route.request().url()).searchParams.get('offset') || 0); longRunOffsets.push(offset);
        const items=Array.from({length:Math.min(20,85-offset)},(_,i)=>({id:3000+offset+i,activity:offset+i<65?'hadith_like':'post',kind:offset+i<65?'like':'note',title:offset+i<65?'Liked bukhari:'+i:'Note',excerpt:offset+i<65?'':'Visible post after the long reaction run '+i,author:{handle:'amina',name:'Amina'},url:'/community/@amina/'+savedId,activityAt:new Date().toISOString()}));
        return route.fulfill({contentType:'application/json',body:JSON.stringify({items,hasMore:offset+20<85,offset:offset+20})});
      });
      await page.reload();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===20);
      await page.locator('#community-feed-sentinel').scrollIntoViewIfNeeded();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      expect(longRunOffsets).toEqual([0]);
      expect(await page.locator('#community-more').isVisible()).toBe(true);
      await page.locator('#community-more').click();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length>=80);
      expect(longRunOffsets.slice(0,4)).toEqual([0,20,40,60]);
      expect(await page.locator('#community-feed [data-kind=like]:visible').count()).toBe(10);
      const longGroup=page.locator('.community-reaction-overflow').first();
      expect(await longGroup.locator('summary').textContent()).toContain('Show 55 more activities');
      await longGroup.locator('summary').click();
      expect(await page.locator('#community-feed [data-kind=like]:visible').count()).toBe(65);
      await longGroup.locator('summary').click();
      await page.locator('#community-feed-sentinel').scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===85);
      expect(await page.locator('#community-feed [data-kind=like]:visible').count()).toBe(10);
      // With automatic observation unavailable, one Load more click must also
      // advance across hidden-only pages to the next visible posts.
      await page.addInitScript(()=>{delete window.IntersectionObserver;});
      longRunOffsets.length=0;
      await page.reload();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===20);
      await page.locator('#community-more').click();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===80);
      expect(longRunOffsets).toEqual([0,20,40,60]);
      expect(await page.locator('#community-feed [data-kind=like]:visible').count()).toBe(10);
      await page.locator('#community-more').click();
      await page.waitForFunction(()=>document.querySelectorAll('#community-feed .community-entry').length===85);
      expect(await page.locator('#community-more').isVisible()).toBe(false);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  },90000);
  test('public pages and private shells render through the real shared templates', async () => {
    for (const page of ['/community','/community/mine','/community/following','/community/write','/community/moderation','/community/@amina']) {
      const response=await request(page,'GET',null); const html=await response.text(); expect({page,status:response.status, error:html.slice(0,300)}).toMatchObject({page,status:200}); expect(html).toContain('id="community"');
    }
    const feed=await Community.feed({kind:'article'}); const response=await request(feed.items[0].url,'GET',null); expect(response.status).toBe(200); expect(await response.text()).toContain('id="community-comments"');
  });
  test('all walls include live source reflections and every community reply without copying private content', async () => {
    await Community.saveProfile({uid:'alice',name:'Amina'}, {name:'Amina',handle:'amina'});
    const published = await Community.savePost({uid:'moderator',name:'Moderator'}, postInput({action:'publish'}));
    await Community.addComment({uid:'alice',name:'Amina'}, published.id, {markdown:'My community reply one'});
    await Community.addComment({uid:'alice',name:'Amina'}, published.id, {markdown:'My community reply two'});
    await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,type,user_uid,user_name,user_email,text,createdAt,deleted) VALUES
      (1,'bukhari:1','hadith','alice','Old name','private@example.test','Live hadith reflection',NOW(3),0),
      (2,'quran:2:255','toc','alice','Old name',NULL,'Live Quran reflection',NOW(3),0),
      (3,'muslim:1','hadith','new-author','New reader',NULL,'New author reflection',NOW(3),0),
      (4,'muslim:2','hadith','alice','Old name',NULL,'Deleted reflection',NOW(3),1),
      (5,'muslim:3','hadith',NULL,'anonymous@example.test',NULL,'Legacy anonymous reflection',NOW(3),NULL)`);
    await q(`INSERT INTO ${prefix}blog_comments (post_slug,user_uid,user_name,text,createdAt,deleted) VALUES
      ('example-post','alice','Old name','Live Blog comment',NOW(3),0)`);
    const all = await Community.feed({kind:'comment'});
    for (const text of ['Live hadith reflection','Live Quran reflection','Live Blog comment','My community reply one','My community reply two','Legacy anonymous reflection'])
      expect(all.items.some(i=>i.excerpt===text)).toBe(true);
    expect(JSON.stringify(all)).not.toMatch(/private@example|anonymous@example|Deleted reflection/);
    expect(all.items.find(i=>i.excerpt==='Live Quran reflection').url).toBe('/quran:2:255#quran-passage-comments-2');
    expect(all.items.find(i=>i.excerpt==='Live Blog comment').url).toBe('/blog/example-post#blog-comments');
    const mine = await Community.feed({scope:'mine',kind:'comment'}, {uid:'alice'});
    expect(mine.items.map(i=>i.excerpt)).toEqual(expect.arrayContaining(['Live hadith reflection','Live Quran reflection','Live Blog comment','My community reply one','My community reply two']));
    expect(mine.items.some(i=>i.excerpt==='New author reflection')).toBe(false);
    expect(mine.items.every(i=>i.author.handle==='amina')).toBe(true);
    await Community.follow({uid:'bob',name:'Bob'}, 'amina', true, false);
    const following = await Community.feed({scope:'following',kind:'comment'}, {uid:'bob'});
    expect(following.items.map(i=>i.excerpt)).toEqual(mine.items.map(i=>i.excerpt));
    const authorWall = await Community.feed({author:'amina',kind:'comment'});
    expect(authorWall.items.map(i=>i.excerpt)).toEqual(mine.items.map(i=>i.excerpt));
    const Reflections = require('../lib/CommunityReflections');
    const wrapped = (s,v) => q(rewrite(s),v);
    const before=(await q(`SELECT COUNT(*) AS n FROM ${prefix}authors`))[0].n;
    await Reflections.backfill(wrapped); await Reflections.backfill(wrapped);
    expect((await q(`SELECT COUNT(*) AS n FROM ${prefix}authors`))[0].n).toBe(before);
    await q(`UPDATE ${prefix}hadiths_comments SET text='Edited source reflection' WHERE ref_num='bukhari:1'`);
    expect((await Community.feed({scope:'mine'}, {uid:'alice'})).items.some(i=>i.excerpt==='Edited source reflection')).toBe(true);
    await q(`UPDATE ${prefix}hadiths_comments SET deleted=1 WHERE ref_num='bukhari:1'`);
    expect((await Community.feed()).items.some(i=>i.excerpt==='Edited source reflection')).toBe(false);
    const articles=await Community.feed({kind:'article'});
    expect(articles.items.every(i=>i.kind==='article')).toBe(true);
  });

  test('likes are idempotent, reuse source votes, respect visibility, and appear in author/following feeds', async () => {
    const published=await Community.savePost({uid:'moderator',name:'Moderator'}, postInput({action:'publish'}));
    const url='/api/community/likes/post/'+published.id;
    await json(url,'PUT',null,{liked:true},401);
    await json(url,'PUT','alice',{liked:'yes'},400);
    expect(await json(url,'PUT','alice',{liked:true})).toEqual({likeCount:1,liked:true});
    expect(await json(url,'PUT','alice',{liked:true})).toEqual({likeCount:1,liked:true});
    let likes=await Community.feed({kind:'like',scope:'mine'},{uid:'alice'});
    expect(likes.items.some(i=>i.likeSource==='post' && i.likeId===published.id)).toBe(true);
    await Community.follow({uid:'bob',name:'Bob'}, 'amina', true, false);
    expect((await Community.feed({kind:'like',scope:'following'},{uid:'bob'})).items.some(i=>i.likeId===published.id)).toBe(true);
    expect((await Community.feed({kind:'article'})).items.find(i=>i.id===published.id).likeCount).toBe(1);
    expect(await json(url,'PUT','alice',{liked:false})).toEqual({likeCount:0,liked:false});
    const comments=await Community.addComment({uid:'bob',name:'Bob'},published.id,{markdown:'Like this reply'});
    await json('/api/community/likes/comment/'+comments[0].id,'PUT','alice',{liked:true});
    const source=(await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,user_uid,user_name,text,createdAt) VALUES (123,'bukhari:123','bob','Bob','A liked reflection',NOW(3))`)).insertId;
    await q(`INSERT INTO ${prefix}hadiths_comments_votes (commentId,user_uid,direction) VALUES (?,'alice','up')`,[source]);
    expect(await json('/api/community/likes/hadiths_comments/'+source,'PUT','alice',{liked:true})).toEqual({likeCount:1,liked:true});
    expect((await Community.feed({kind:'comment'})).items.find(i=>i.activity==='hadiths_comments' && i.id===source).likeCount).toBe(1);
    await json('/api/community/likes/hadiths_comments/'+source,'PUT','alice',{liked:false});
    expect((await q(`SELECT COUNT(*) n FROM ${prefix}hadiths_comments_votes WHERE commentId=?`,[source]))[0].n).toBe(0);
    const blog=(await q(`INSERT INTO ${prefix}blog_comments (post_slug,user_uid,user_name,text,createdAt) VALUES ('blog-like','bob','Bob','Blog reflection',NOW(3))`)).insertId;
    await json('/api/community/likes/blog_comments/'+blog,'PUT','alice',{liked:true});
    expect((await Community.feed({kind:'like',scope:'mine'},{uid:'alice'})).items.some(i=>i.activity==='blog_comments_like' && i.likeId===blog)).toBe(true);
    await q(`INSERT INTO ${prefix}hadiths_likes (hadithId,ref_num,type,user_uid,user_name,createdAt) VALUES (1,'bukhari:1','hadith','alice','Amina',NOW(3))`);
    expect((await Community.feed({kind:'like',scope:'mine'},{uid:'alice'})).items.some(i=>i.activity==='hadith_like')).toBe(true);
    await Community.savePost({uid:'moderator'}, {...postInput({action:'unpublish'}),version:published.version},published.id);
    await json(url,'PUT','alice',{liked:true},404);
    expect((await Community.feed({kind:'like'})).items.some(i=>i.likeSource==='comment' && i.likeId===comments[0].id)).toBe(false);
  });

  test('historical photos and Gravatar reach contributor profiles without overwriting sign-in photos', async () => {
    const Avatar=require('../lib/UserAvatar');
    const wrapped=(sql,args)=>q(rewrite(sql),args);
    const user={uid:'historical-photo',name:'Historical photo'};
    const author=await Community.authorFor(user);
    await Avatar.seedHistorical(wrapped,{user_uid:user.uid,user_email:'old@example.test',user_photo:'https://avatar.test/old.png'});
    expect((await Community.profile(author.handle)).photo).toBe('https://avatar.test/old.png');
    await Avatar.remember({...user,email:'new@example.test',photo:'https://avatar.test/current.png'});
    await Avatar.seedHistorical(wrapped,{user_uid:user.uid,user_email:'old@example.test',user_photo:'https://avatar.test/old.png'});
    expect((await Community.profile(author.handle)).photo).toBe('https://avatar.test/current.png');
    const fallback=await Community.authorFor({uid:'historical-fallback',name:'Fallback'});
    await Avatar.seedHistorical(wrapped,{user_uid:'historical-fallback',user_email:'fallback@example.test'});
    expect((await Community.profile(fallback.handle)).photo).toBe(Avatar.gravatar('fallback@example.test'));
  });

  test('each verified sign-in refreshes the central photo used by existing contributions and falls back to Gravatar', async () => {
    const Auth=require('../lib/GoogleAuth'), Settings=require('../lib/UserSettings'), Avatars=require('../lib/UserAvatar');
    const settingsSpy=jest.spyOn(Settings,'ensureLoginUser').mockResolvedValue(false);
    const user={uid:'alice',name:'Amina',email:'Alice@Private.Test',provider:'google.com'};
    try {
      for(const photo of ['https://avatar.test/first.png','https://avatar.test/second.png',null]) {
        Auth.verifyRequest.mockResolvedValueOnce({...user,photo});
        const response=await request('/api/login/alice'); expect(response.status).toBe(200);
        const saved=(await q(`SELECT photo,gravatar FROM ${prefix}user_profile_photos WHERE user_uid='alice'`))[0];
        expect(saved.photo).toBe(photo); expect(saved.gravatar).toBe(Avatars.gravatar(user.email));
        const profile=await Community.profile('amina');
        expect(profile.photo).toBe(photo || Avatars.gravatar(user.email));
        const feed=await Community.feed({author:'amina'});
        expect(feed.items.length).toBeGreaterThan(0);
        expect(feed.items.every(i=>i.author.photo===profile.photo)).toBe(true);
        expect(JSON.stringify(profile)).not.toContain('Private.Test');
        const sourceRows=[{user_uid:'alice',user_photo:'https://avatar.test/old-comment.png',user_email:user.email}];
        await Avatars.decorateRows(sourceRows); expect(sourceRows[0].avatarPhoto).toBe(profile.photo);
      }
      const signedIn=(await Community.authorFor(user));
      await Community.authorFor({...user,photo:'https://avatar.test/stale-token.png'});
      expect((await Community.profile(signedIn.handle)).photo).toBe(Avatars.gravatar(user.email));
    } finally { settingsSpy.mockRestore(); }
  });

  test('top contributors count only public contributions, include self, and expose persisted follow state', async () => {
    await Community.saveProfile({uid:'rank-high',name:'Top writer'}, {handle:'top-writer',name:'Top writer'});
    await Community.saveProfile({uid:'rank-low',name:'Likes only'}, {handle:'likes-only',name:'Likes only'});
    for(let i=0;i<20;i++) await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,user_uid,user_name,text,createdAt,deleted) VALUES (1,'bukhari:1','rank-high','Top writer','Public reflection',NOW(3),0)`);
    await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,user_uid,user_name,text,createdAt,deleted) VALUES (1,'bukhari:1','rank-high','Top writer','Removed reflection',NOW(3),1)`);
    await Community.savePost({uid:'rank-low',name:'Likes only'},postInput({action:'draft'}));
    await q(`INSERT INTO ${prefix}hadiths_likes (hadithId,ref_num,type,user_uid,user_name,createdAt) VALUES (1,'bukhari:1','hadith','rank-low','Likes only',NOW(3))`);
    let result=await json('/api/community/contributors','GET',null);
    expect(result.contributors[0]).toMatchObject({handle:'top-writer',contributions:20,following:false});
    expect(result.contributors.some(a=>a.handle==='likes-only')).toBe(false);
    expect(await Community.profile('top-writer')).toMatchObject({posts:0,comments:20,followers:0,following:0});
    expect((await Community.profile('likes-only')).posts).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/rank-high|rank-low|private.test/);
    expect((await Community.contributors({uid:'rank-high'})).some(a=>a.handle==='top-writer')).toBe(true);
    await Community.follow({uid:'alice'},'top-writer',true,false);
    expect((await Community.profile('top-writer')).followers).toBe(1);
    const ownStats=(await json('/api/community/me','GET','alice')).author;
    expect(ownStats.following).toBeGreaterThanOrEqual(1);
    expect(ownStats).not.toHaveProperty('uid');
    expect(ownStats).not.toHaveProperty('email');
    result=await json('/api/community/contributors','GET','alice');
    expect(result.contributors.find(a=>a.handle==='top-writer').following).toBe(true);
    await Community.follow({uid:'alice'},'top-writer',false,false);
    expect((await json('/api/community/contributors','GET','alice')).contributors.find(a=>a.handle==='top-writer').following).toBe(false);
    await json('/api/community/contributors','GET','expired');
  });

});
