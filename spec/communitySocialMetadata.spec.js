'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const {load} = require('cheerio');
const metadata = require('../lib/CommunitySocialMetadata');
const C = require('../lib/Community');
const router = require('../routes/community').pages;
const guid = '483bb19c-9951-46fd-8f61-e07a1196e6ee';
afterEach(()=>jest.restoreAllMocks());
async function page(route, req) {
  const res={locals:{},set:jest.fn(),render:jest.fn(),redirect:jest.fn()};
  const handler=router.stack.find(layer=>layer.route?.path===route).route.stack[0].handle;
  await handler(req,res,err=>{throw err;});
  return res.render.mock.calls[0][1].page;
}
function head(page) {
  return load(ejs.render(fs.readFileSync(path.join(__dirname,'../views/sub-views/head.ejs'),'utf8'),{
    page,site:{name:'Hadith Unlocked',url:'https://hadith.example',logo:'/static/img/logo.png'},
    req:{originalUrl:page.canonical,query:{}},utils:require('../lib/Utils'),arabic:{}
  }));
}
test('Community route puts recent anonymous activity into crawler-visible Open Graph tags',async()=>{
  const feed=jest.spyOn(C,'feed').mockResolvedValue({items:[
    {activity:'comment',kind:'comment',author:{name:'Amina'},excerpt:'**Mercy** & رحمة'},
    {activity:'repost',kind:'article',author:{name:'Original author'},repostedBy:{name:'Reader'},title:'A reflection'}
  ]});
  const result=await page('/',{path:'/'}),$=head(result);
  expect(feed).toHaveBeenCalledWith();
  expect($('meta[property="og:description"]').attr('content')).toBe('Recent community activity — Amina commented: Mercy & رحمة • Reader reposted: A reflection');
  expect($('meta[property="og:url"]').attr('content')).toBe('https://hadith.example/community');
});
test.each(['Post','A reflection'])('GUID post links include author-aware titles and absolute cover images: %s',async title=>{
  const url='/community/p/'+guid;
  jest.spyOn(C,'post').mockResolvedValue({id:12,guid,url,title,author:{name:'Amina أحمد'},excerpt:'Published text',coverUrl:'/community/media/abc'});
  const result=await page('/p/:guid',{path:'/p/'+guid,params:{guid}}),$=head(result);
  expect($('meta[property="og:title"]').attr('content')).toBe(title==='Post'?'Post by Amina أحمد':'A reflection — Amina أحمد');
  expect($('meta[property="og:image"]').attr('content')).toBe('https://hadith.example/community/media/abc');
  expect($('meta[property="og:image:width"]').length).toBe(0);
  expect($('meta[name="twitter:image"]').attr('content')).toBe('https://hadith.example/community/media/abc');
  expect($('meta[property="og:url"]').attr('content')).toBe('https://hadith.example'+url);
});
test('uses a readable fallback for an empty feed and brand artwork for posts without a cover',()=>{
  expect(metadata('everyone',{initial:{items:[]}}).description_en).toContain('Reader posts');
  const $=head({canonical:'/community/p/'+guid,context:{},...metadata('post',{post:{title:'Post',author:{name:'Reader'},excerpt:'Text'}})});
  expect($('meta[property="og:image"]').attr('content')).toBe('https://hadith.example/static/img/pwa/hadith-512.png');
});
test.each(['mine','following','author','write','moderation','unsubscribe'])('does not summarize private context from %s',view=>{
  expect(metadata(view,{initial:{items:[{excerpt:'Private content'}]}})).toEqual({});
});
test('excludes draft content even when mistakenly supplied to the metadata helper',()=>{
  expect(metadata('post',{post:{status:'draft',title:'Secret'}})).toEqual({});
  expect(metadata('everyone',{initial:{items:[{status:'draft',excerpt:'Secret'}]}}).description_en).not.toContain('Secret');
});
test('imported blog metadata carries the existing public display name',()=>{
  const attr=require('../lib/CommunityBlogImport').attributes({author_name:'Amina Private',custom_name:0,attributes_json:'{}',published_at:'2026-01-01',guid});
  expect(attr.authorName).toBe('Amina');
  expect(attr.shareUrl).toBe('/community/p/'+guid);
});
