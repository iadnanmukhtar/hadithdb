'use strict';
const {chapterSections}=require('../lib/HadithIntroductionSections');
const Index=require('../lib/Index');
const Navigation=require('../lib/HadithHeadingNavigation');
afterEach(()=>jest.restoreAllMocks());
const article={id:170316,book_id:100420,book_alias:'shuab',level:2,h1:0,h2:14,ordinal:904286,h2_count:0,path:'shuab/0/14'};
const first={...article,id:169896,h2:1,ordinal:904288,h2_count:3,path:'shuab/0/1'};
const reality={...article,id:169897,h2:2,ordinal:904289,path:'shuab/0/2'};
test('chapter zero lists Reality of Faith but excludes the authored book article',()=>{
 expect(chapterSections([article,first,reality]).map(r=>r.id)).toEqual([169896,169897]);
});
test('next chapter navigation opens Reality of Faith, not the book introduction',async()=>{
 jest.spyOn(Index,'docsFromQueryString').mockImplementation(async(_index,q)=>{
  if(q.includes('h2_count:>0'))return [first];
  if(q.includes('ordinal:<'))return [article];
  if(q.includes('ordinal:>'))return [reality];
  return [];
 });
 const current={...first};await Navigation.applySameBookHeadingNavigation(current);
 expect(current.prev.path).toBe('shuab/introduction');
 expect(current.next.path).toBe('shuab/0/2');
});
test('renders the book article once and Reality of Faith only as a chapter section',()=>{
 const fs=require('fs'),path=require('path'),ejs=require('ejs'),cheerio=require('cheerio');
 const template=fs.readFileSync(path.join(__dirname,'../views/toc.ejs'),'utf8');
 const start=template.indexOf('<table id="toc"');
 const table=template.slice(start,template.indexOf('</table>',start)+8);
 const parent={id:169895,h1:0,count:86,start:1,title_en:'Introduction',title:'مقدمة',sections:[
  {...article,title_en:'Author introduction',intro:'Book introduction'},
  {...first,title_en:'Branches of faith'},
  {...reality,title_en:'Reality of Faith'}
 ]};
 const $=cheerio.load(ejs.render(table,{
  book:{alias:'shuab',type:'hadith',name_en:'Shuab',title:'شعب الإيمان'},toc:[parent],
  hadithIntroductionArticles:[{...article,title_en:'Author introduction',intro:'Book introduction'}],
  hadithIntroductionHref:'/shuab/introduction',showTocStartNumbers:true,displayName:v=>v||'',
  utils:{trimToEmpty:v=>v||''},formatHeadingNumber:v=>v,truncateTitle:v=>v||'',
  tocHeadingRailKeys:new Map(),quranTocHref:r=>'/'+(r.path||'shuab/0'),
  tocSectionNumberLabel:r=>'S0.'+r.h2,quranCommentaryBook:null,quranCommentaryBookLabel:''
 }));
 expect($('.hadith-introduction-link-row')).toHaveLength(1);
 expect($('.hadith-introduction-link-row').text()).toContain('Author introduction');
 expect($('.toc-section-row').text()).not.toContain('Author introduction');
 expect($('.toc-section-row a[href="/shuab/0/2"]').first().text()).toBe('Reality of Faith');
});
