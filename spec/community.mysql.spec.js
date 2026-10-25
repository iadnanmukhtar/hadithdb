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
  const tables = ['authors','posts','revisions','follows','comments','reports','email_outbox','likes'];
  const rewrite = statement => statement.replace(/\b(user_profile_photos|hadiths_comments_votes|blog_comments_votes|hadiths_likes|hadiths_comments|blog_comments)\b/g, (_, table) => prefix + table).replace(/\bcommunity_(authors|posts|revisions|follows|comments|reports|email_outbox|likes)\b/g, (_, table) => prefix + table);
  let pool, server, base, q, firstId;
  const request = (url, method = 'GET', uid = 'alice', body) => fetch(base + url, { method, headers: { ...(uid ? { Authorization: 'Bearer ' + uid } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (url, method, uid, body, expected = 200) => { const response = await request(url, method, uid, body); const data = await response.json(); expect({ status: response.status, error: data.error }).toEqual({ status: expected, error: expected >= 400 ? expect.any(String) : undefined }); return data; };
  const postInput = overrides => ({ kind: 'article', title: 'A reflection العربية', markdown: 'Original published body', tags: 'learning', action: 'draft', ...overrides });
  beforeAll(async () => {
    process.env.COMMUNITY_MODERATOR_UIDS = 'moderator';
    pool = mysql.createPool({ ...require('../bin/initializeHadithAttributions').connectionSettings(), connectionLimit: 5, supportBigNumbers: true });
    q = promisify(pool.query).bind(pool);
    const wrapConnection = connection => ({ query: (s,v,cb) => connection.query(rewrite(s),v,cb), beginTransaction: connection.beginTransaction.bind(connection), commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection), release: connection.release.bind(connection) });
    global.dbPool = { query: (s,v,cb) => pool.query(rewrite(s),v,cb), getConnection: cb => pool.getConnection((err, connection) => cb(err, connection && wrapConnection(connection))) };
    global.settings = { sessionSecret:'isolated-avatar-test-secret', site: { name:'HadithDB', shortName:'HadithDB', url:'http://127.0.0.1', desc:'HadithDB', lang:'en', logo:'/static/img/logo2.svg', quranUrl:'http://127.0.0.1' }, smtp: { from:'test@private.test' }, google:{} };
    global.utils = require('../lib/Utils'); global.arabic = require('../lib/Arabic'); global.qs = require('qs'); global.books=[];
    const app = express(); app.locals.googleAnalyticsTagId = ''; app.locals.Tafsir = require('../lib/Tafsir'); app.locals.BookGroups = require('../lib/BookGroups'); app.use(express.json()); app.use(express.urlencoded({extended:false})); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname,'../views'));
    app.use('/api/login', require('../routes/login'));
    app.get('/blog', (req, res) => res.render('blog', { req, posts: [] }));
    app.get(['/notebook', '/quran/notebook'], require('../routes/notebook').page);
    app.use('/static', express.static(path.join(__dirname,'../public/static')));
    app.use('/api/community', require('../routes/community').api); app.use('/quran/api/community', require('../routes/community').api); app.use('/community', require('../routes/community').pages);
    app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({error:err.message}); });
    server=http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port;
    global.settings.site.url=base;
    global.settings.blog={...global.settings.site};
    await Community.ensure();
    for (const source of ['hadiths_comments','blog_comments']) await q(`CREATE TABLE ${prefix}${source} (
      id INT PRIMARY KEY AUTO_INCREMENT, hadithId INT, ref_num VARCHAR(45), type VARCHAR(16), post_slug VARCHAR(255),
      parentId INT, user_uid VARCHAR(255) COLLATE utf8mb4_bin, user_name VARCHAR(255), user_email VARCHAR(255),
      text TEXT, up_vote INT DEFAULT 0, down_vote INT DEFAULT 0, createdAt DATETIME(3), deleted TINYINT DEFAULT 0) DEFAULT CHARSET=utf8mb4`);
    for (const source of ['hadiths_comments_votes','blog_comments_votes']) await q(`CREATE TABLE ${prefix}${source} (
      id INT PRIMARY KEY AUTO_INCREMENT, commentId INT, user_uid VARCHAR(255) COLLATE utf8mb4_bin, direction VARCHAR(8)) DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE ${prefix}hadiths_likes (id INT PRIMARY KEY AUTO_INCREMENT, hadithId INT, type VARCHAR(16), ref_num VARCHAR(45), user_uid VARCHAR(255) COLLATE utf8mb4_bin, user_name VARCHAR(255), createdAt DATETIME(3)) DEFAULT CHARSET=utf8mb4`);
  });
  afterAll(async () => {
    if (server) await new Promise(resolve=>server.close(resolve));
    if (q) for (const source of ['user_profile_photos','hadiths_comments_votes','blog_comments_votes','hadiths_likes','hadiths_comments','blog_comments']) await q(`DROP TABLE IF EXISTS ${prefix}${source}`);
    if (q) for (const table of [...tables].reverse()) await q(`DROP TABLE IF EXISTS ${prefix}${table}`);
    if (pool) await promisify(pool.end).call(pool);
    delete process.env.COMMUNITY_MODERATOR_UIDS;
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
        if (request.resourceType()==='script' && !url.includes('/static/js/community.js') && !url.includes('/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js')) return route.abort();
        if (url.includes('avatar.test/missing')) return route.fulfill({status:404,body:''});
        if (url.includes('avatar.test/') || url.includes('gravatar.com/avatar/')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#2c9be5"/></svg>'});
        if (request.resourceType()==='image' && !url.includes('/static/')) return route.abort();
        return route.continue();
      });
      const page=await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/community/write');
      await page.evaluate(()=>localStorage.setItem('community-test-uid','alice'));
      await page.reload();
      await page.locator('#community-kind').selectOption('article');
      await page.locator('#community-title').fill('Browser article العربية');
      await page.locator('#community-markdown').fill('## العربية\n\nA **browser-tested** reflection.');
      expect(await page.locator('#community-publish').isDisabled()).toBe(true);
      await page.locator('#community-preview-button').click();
      await page.waitForFunction(()=>!document.getElementById('community-publish').disabled);
      expect(await page.locator('#community-preview strong').textContent()).toBe('browser-tested');
      await page.locator('#community-publish').click();
      await page.waitForFunction(()=>document.getElementById('community-status').textContent==='Your post is public.');
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
      await page.locator('#community-subscribe').click();
      await page.waitForFunction(()=>document.getElementById('community-subscribe').textContent.includes('Stop emails'));
      await page.locator('#community-comment-text').fill('A mobile reflection');
      await page.locator('#community-comment-form [type=submit]').click();
      await page.waitForFunction(()=>document.getElementById('community-comments').textContent.includes('A mobile reflection'));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-mobile.png',fullPage:true});
      await page.goto(base+'/community/mine');
      await page.waitForFunction(()=>!document.getElementById('community-public-wall').hidden);
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
      expect(await page.locator('#community-public-wall').getAttribute('href')).toBe('/community/@amina');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'/tmp/community-my-wall-mobile.png',fullPage:true});
      expect(await page.locator('.community-tabs [aria-current=page]').textContent()).toContain('Wall');
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
  },60000);
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

  test('top contributors count only public contributions, exclude self, and expose persisted follow state', async () => {
    await Community.saveProfile({uid:'rank-high',name:'Top writer'}, {handle:'top-writer',name:'Top writer'});
    await Community.saveProfile({uid:'rank-low',name:'Likes only'}, {handle:'likes-only',name:'Likes only'});
    for(let i=0;i<20;i++) await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,user_uid,user_name,text,createdAt,deleted) VALUES (1,'bukhari:1','rank-high','Top writer','Public reflection',NOW(3),0)`);
    await q(`INSERT INTO ${prefix}hadiths_comments (hadithId,ref_num,user_uid,user_name,text,createdAt,deleted) VALUES (1,'bukhari:1','rank-high','Top writer','Removed reflection',NOW(3),1)`);
    await Community.savePost({uid:'rank-low',name:'Likes only'},postInput({action:'draft'}));
    await q(`INSERT INTO ${prefix}hadiths_likes (hadithId,ref_num,type,user_uid,user_name,createdAt) VALUES (1,'bukhari:1','hadith','rank-low','Likes only',NOW(3))`);
    let result=await json('/api/community/contributors','GET',null);
    expect(result.contributors[0]).toMatchObject({handle:'top-writer',contributions:20,following:false});
    expect(result.contributors.some(a=>a.handle==='likes-only')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/rank-high|rank-low|private.test/);
    expect((await Community.contributors({uid:'rank-high'})).some(a=>a.handle==='top-writer')).toBe(false);
    await Community.follow({uid:'alice'},'top-writer',true,false);
    result=await json('/api/community/contributors','GET','alice');
    expect(result.contributors.find(a=>a.handle==='top-writer').following).toBe(true);
    await Community.follow({uid:'alice'},'top-writer',false,false);
    expect((await json('/api/community/contributors','GET','alice')).contributors.find(a=>a.handle==='top-writer').following).toBe(false);
    await json('/api/community/contributors','GET','expired');
  });

});
