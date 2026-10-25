'use strict';
const ejs=require('ejs'),path=require('path'),{load}=require('cheerio');
test('server feed renders safe title text and collapses only consecutive title runs',async()=>{
 const title={id:1,kind:'note',activity:'post',microinteraction:'title',title:'Titled ahmad:11133',hadithTitle:'Acceptance of dua <script>',hadithRef:'ahmad:11133',hadithUrl:'/ahmad:11133',author:{handle:'editor',name:'Editor'},url:'/community/@editor/1',activityAt:'2026-01-01'};
 const items=[...Array(12).fill(title),{...title,microinteraction:undefined,kind:'like',activity:'hadith_like'},...Array(11).fill(title)];
 const $=load(await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_feed.ejs'),{items}));
 expect($('details').length).toBe(2);
 expect($('details').eq(0).find('article').length).toBe(2);
 expect($('details').eq(1).find('article').length).toBe(1);
 expect($('[data-kind=title] h2,script').length).toBe(0);
 expect($('[data-kind=title]').first().text()).toContain('Acceptance of dua <script>');
 expect($('[data-kind=title] a[href="/ahmad:11133"]').length).toBe(23);
});
test('edit pencils appear for owned ordinary posts but never microinteractions',async()=>{
 const base={id:12,activity:'post',kind:'article',title:'Article',excerpt:'Public text',author:{handle:'writer',name:'Writer'},url:'/community/@writer/12',activityAt:'2026-01-01'};
 const compact={...base,kind:'note',microinteraction:'title',hadithTitle:'Hadith title',hadithRef:'bukhari:1',hadithUrl:'/bukhari:1'};
 for(const item of [base,compact]){
  const render=async canEdit=>load(await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_card.ejs'),{item:{...item,canEdit}}));
  expect((await render(true))('[aria-label="Edit post"]').length).toBe(item.microinteraction ? 0 : 1);
  expect((await render(false))('[aria-label="Edit post"]').length).toBe(0);
 }
});
