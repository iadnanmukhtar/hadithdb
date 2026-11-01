'use strict';
const fs=require('fs'), path=require('path'), ejs=require('ejs'), {load}=require('cheerio');
const {chromium}=require('playwright');
const Notebook=require('../lib/UserNotebook'), Community=require('../lib/Community');
const markdown='# Shared rendering\n\n## Heading العربية\n\nEnglish **bold**, *italic*, ==highlight== and __underline__.\n\n> **إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ**\n> Actions are judged by intentions.\n\n> English opening.\n>\n> ثُمَّ تَأْتِي التَّرْجَمَةُ العَرَبِيَّةُ\n\n- First item\n  - Nested العربية\n- Second item\n\nEnglish || العربية\n\n-# Small text\n\n- [x] Complete\n\nH~2~O X^2^\n\n| Term | Meaning |\n| --- | --- |\n| العربية | Arabic |\n\nA footnote.[^1]\n\n[^1]: Footnote العربية\n\n```js\nconst value = 1;\n```';
const row={id:42,kind:'article',public_title:'Shared rendering',public_markdown:markdown,published_at:new Date('2026-11-01T12:00:00Z'),name:'Writer',handle:'writer'};
let browser,server,origin;
jest.setTimeout(30000);
beforeAll(async()=>{
 server=require('http').createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/static/')){
   const file=path.join(__dirname,'../public',url.pathname);
   if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'font/woff2');
   let body=fs.readFileSync(file);if(file.endsWith('style.css'))body=body.toString().replace(/^@import[^;]+;/,'');res.end(body);return;
  }
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head></head><body></body></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});
});
afterAll(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
function render(file,data){
 const filename=path.resolve('views',file);
 return ejs.render(fs.readFileSync(filename,'utf8'),{global:{settings:{site:{},blog:{}}},utils:{scriptAssetVersion:()=> 'test',staticAssetUrl:x=>x},page:{},...data,
 include:(name,locals)=>name.endsWith('blog_cover.ejs')||name.endsWith('community_post_actions.ejs')?ejs.render(fs.readFileSync(path.resolve('views',name),'utf8'),locals,{filename:path.resolve('views',name)}):''},{filename});
}
function content(kind){
 if(kind==='note')return `<article class="notebook-markdown">${Notebook.render(markdown)}</article>`;
 const post=Community.postView({...row,kind:kind==='post'?'note':'article'});
 if(kind==='blog'){
  const html=render('blog_post.ejs',{slug:'shared',body:post.html,attr:{title:post.title,published:new Date(),postId:42,coverUrl:'',authorHandle:'writer',authorName:'Writer'}});
  return load(html)('[data-article-body]').toString();
 }
 return load(render('community.ejs',{view:'post',post,author:post.author}))('.community-reflection-body').first().toString();
}
const styles='<link rel="stylesheet" href="/static/css/style.css"><link rel="stylesheet" href="/static/css/community.css"><link rel="stylesheet" href="/static/css/markdown-content.css">';
test('same Markdown has identical screen typography and print styling across notes, posts and both article routes',async()=>{
 const context=await browser.newContext(),page=await context.newPage();await page.goto(origin);
 const kinds=['note','post','article','blog'];
 await page.setContent(`${styles}<style>body{background:white;color:#222}#comparison{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;padding:24px}.sample{min-width:0}.sample>header{font:600 16px Arial;margin-bottom:20px}.community{padding:0!important}@media(max-width:600px){#comparison{grid-template-columns:1fr}}</style><div id="comparison">${kinds.map(kind=>`<section class="sample ${kind==='note'?'':kind==='post'?'community community-reading':'community community-article'}"><header>${kind}</header>${content(kind)}</section>`).join('')}</div>`);
 const selectors=['h1','h2','p','.notebook-arabic','blockquote','ul','li','.notebook-parallel','.notebook-subtext','table','td','pre','.footnotes'];
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.locator('.sample').evaluateAll((els,selectors)=>els.map(el=>selectors.map(sel=>{const s=getComputedStyle(el.querySelector('.notebook-markdown '+sel));return [s.fontFamily,s.fontSize,s.lineHeight,s.marginTop,s.marginBottom,s.paddingInlineStart,s.borderInlineStartWidth,sel==='blockquote'?s.borderInlineStartColor:null]})),selectors);
  for(const result of metrics.slice(1))expect(result).toEqual(metrics[0]);
  const quotes=await page.locator('.sample blockquote').evaluateAll(es=>es.map(e=>{const p=e.querySelector('p'),s=getComputedStyle(e);return {dir:e.dir,align:getComputedStyle(p).textAlign,left:s.borderLeftWidth,right:s.borderRightWidth,color:s.borderInlineStartColor};}));
  for(const quote of quotes)expect(quote).toEqual({dir:quote.dir,align:quote.dir==='rtl'?'right':'left',left:quote.dir==='rtl'?'0px':'3px',right:quote.dir==='rtl'?'3px':'0px',color:'rgb(44, 155, 229)'});
  await page.screenshot({path:`/tmp/hadith-shared-markdown-${width}.png`,fullPage:true});
 }
 await page.addScriptTag({path:require.resolve('../public/static/js/notebook-print.js')});
 await page.evaluate(()=>{const open=window.open.bind(window);window.open=(...args)=>{const popup=open(...args);popup.print=()=>{popup.didPrint=true};return popup;};});
 let firstMetrics;
 for(const kind of kinds){
  const html=load(content(kind))('.notebook-markdown').html();
  const popupEvent=page.waitForEvent('popup');await page.evaluate(html=>NotebookPrint.open({title:'Shared rendering'},async()=>({html}),()=>true),html);const popup=await popupEvent;
  await popup.waitForFunction(()=>window.didPrint);await popup.emulateMedia({media:'print'});
  const metrics=await popup.locator('article').evaluate((el,selectors)=>selectors.map(sel=>{const s=getComputedStyle(el.querySelector(sel));return [s.fontFamily,s.fontSize,s.lineHeight,s.marginTop,s.marginBottom,s.borderLeftWidth,s.borderRightWidth]}),selectors);
  if(firstMetrics)expect(metrics).toEqual(firstMetrics);else firstMetrics=metrics;
  expect(await popup.locator('blockquote').first().evaluate(el=>getComputedStyle(el).borderRightWidth)).toBe('3px');
  expect(await popup.locator('.notebook-arabic').first().evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Hafs');
  await popup.pdf({path:`/tmp/hadith-shared-${kind}.pdf`,format:'A4',preferCSSPageSize:true});await popup.close();
 }
 await context.close();
});
test.each(['post','article','blog'])('%s menu Print opens the notes print flow with the full authorized body',async kind=>{
 const context=await browser.newContext(),page=await context.newPage();await page.goto(origin+'/community/p/test');
 const post=Community.postView({...row,kind:kind==='post'?'note':'article'});
 const menu=await ejs.renderFile(path.resolve('views/sub-views/community_post_actions.ejs'),{post});
 await page.setContent(`${styles}<main id="community" class="community" data-view="${kind==='blog'?'blog-article':'post'}" data-post="42" data-author="writer"><p id="community-status"></p>${content(kind)}${menu}</main>`);
 await page.evaluate(post=>{
  window.quranApiPath=p=>p;window.hadithAuth={getToken:async()=>null};
  window.fetch=async url=>({ok:true,json:async()=>url.endsWith('/me')?{author:null}:url.endsWith('/posts/42')?{post}:{comments:[],contributors:[]}});
  const open=window.open.bind(window);window.open=(...args)=>{const popup=open(...args);popup.print=()=>{popup.didPrint=true};return popup;};
 },post);
 await page.addScriptTag({path:require.resolve('../public/static/js/notebook-print.js')});await page.addScriptTag({path:require.resolve('../public/static/js/community.js')});
 await page.locator('.community-post-menu summary').click();const popupEvent=page.waitForEvent('popup');await page.locator('[data-community-print]').click();const popup=await popupEvent;
 await popup.waitForFunction(()=>window.didPrint);
 expect(await popup.locator('article').textContent()).toContain('Footnote العربية');
 expect(await popup.locator('header h1').textContent()).toBe('Shared rendering');
 expect(await popup.locator('article .community-secondary-menu').count()).toBe(0);
 expect(await page.locator('[data-community-print]').isEnabled()).toBe(true);
 await context.close();
});
