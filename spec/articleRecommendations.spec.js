'use strict';
const ejs=require('ejs'),fs=require('fs'),{load}=require('cheerio');
const template=fs.readFileSync('views/sub-views/article_recommendations.ejs','utf8');
test('related articles render escaped titles and pills without a recent section',()=>{
 const article={url:'/blog/faith',title:'Faith <script>bad()</script>',category:'Hadith',coverUrl:'/cover.jpg',authorHandle:'amina'};
 const $=load(ejs.render(template,{relatedArticles:[article],recentArticles:[{...article,url:'/community/p/another',title:'Another article'}]},{filename:'views/sub-views/article_recommendations.ejs'}));
 expect($('section[aria-label="Related posts"] .article-mini-pill').text()).toBe('Hadith');
 expect($('section[aria-label="Recent articles"]')).toHaveLength(0);
 expect($('script')).toHaveLength(0);expect($('.article-recommendation-title').first().text()).toBe(article.title);
});
test('empty recommendations leave no blank panels',()=>{
 expect(load(ejs.render(template,{}))('.article-recommendations')).toHaveLength(0);
});
test('bio and author controls stay above author articles while the heading rail stays independent',()=>{
 const {JSDOM}=require('jsdom');
 const filename='views/sub-views/community_author_rail.ejs';
 const rail=ejs.render(fs.readFileSync(filename,'utf8'),{railAuthor:{name:'Amina',handle:'amina'},authorArticles:[{url:'/blog/another',title:'Another article',category:'Hadith',coverUrl:'/cover.jpg',authorHandle:'amina'}]},{filename});
 const dom=new JSDOM(rail+'<main data-article-body><h2 id="intro">Introduction</h2><h2 id="sources">Sources</h2></main><aside class="community-aside"></aside>',{runScripts:'outside-only',pretendToBeVisual:true});
 try {
  dom.window.eval(fs.readFileSync('public/static/js/community-article-toc.js','utf8'));
  const d=dom.window.document,bio=d.querySelector('[data-article-author-bio]'),more=d.querySelector('.community-author-articles');
  expect(bio.compareDocumentPosition(more) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(d.querySelector('[data-author-follow]').compareDocumentPosition(more) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(more.querySelector('a').getAttribute('href')).toBe('/blog/another');
  expect([...d.querySelectorAll('.community-aside .community-article-toc a')].map(a=>a.textContent)).toEqual(['Introduction','Sources']);
  expect(d.querySelector('.community-author-rail .community-article-toc')).toBeNull();
 } finally {dom.window.close();}
});
