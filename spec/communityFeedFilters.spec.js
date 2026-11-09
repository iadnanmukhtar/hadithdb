'use strict';
const Filters = require('../lib/CommunityFeedFilters');
test('validates categories and normalizes single lowercase tags',()=>{
 expect(Filters.normalize({category:'Fiqh',tag:' PRAYER '})).toEqual({category:'Fiqh',tag:'prayer'});
 for(const input of [{category:'unknown'},{category:[]},{tag:[]},{tag:'one,two'}]) expect(()=>Filters.normalize(input)).toThrow();
});
test('exact tag matching escapes regex metacharacters and preserves owner snapshot choice',()=>{
 const params=[];
 expect(Filters.predicate({category:'Hadith',tag:'a.b+(c)'},'mine',params)).toBe("p.kind='article' AND p.category=? AND LOWER(p.tags) REGEXP ?");
 expect(params).toEqual(['Hadith','(^|,)[[:space:]]*a\\.b\\+\\(c\\)[[:space:]]*(,|$)']);
});
test('article templates compile with linked lowercase tags',()=>{
 const fs=require('fs'),ejs=require('ejs');
 for(const path of ['views/community.ejs','views/blog_post.ejs','views/sub-views/community_card.ejs']) expect(()=>ejs.compile(fs.readFileSync(path,'utf8'),{filename:path})).not.toThrow();
});
test('browser filters retain category with tag, clear independently, and restore URL state',()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');
 const dom=new JSDOM('<select id="community-filter"><option value="all">All activity</option><option value="article">Articles</option><option value="note">Posts</option></select><select id="community-category-filter"><option value="">All categories</option><option>Fiqh</option><option>Hadith</option></select><button id="community-tag-filter"></button>',{url:'https://example.test/community?filter=article&category=Fiqh&tag=prayer',runScripts:'outside-only'});
 const win=dom.window;
 win.eval("var $ = id => document.getElementById('community-'+id); var run = fn => fn(); var loadFeed = () => {}; var init = () => {};");
 const source=fs.readFileSync('public/static/js/community.js','utf8');
 win.eval(source.slice(source.indexOf('  function writeFilterUrl('),source.indexOf("  $('more')?.addEventListener('click'")));
 const activity=win.document.getElementById('community-filter'),category=win.document.getElementById('community-category-filter'),tag=win.document.getElementById('community-tag-filter');
 expect(category.value).toBe('Fiqh');expect(activity.value).toBe('article');expect(tag.textContent).toBe('#prayer ×');
 category.value='Hadith';category.dispatchEvent(new win.Event('change'));
 expect(new URL(win.location.href).searchParams.get('tag')).toBe('prayer');
 expect(new URL(win.location.href).searchParams.get('category')).toBe('Hadith');
 tag.click();expect(win.location.search).not.toContain('tag=');expect(category.value).toBe('Hadith');expect(tag.hidden).toBe(true);
 activity.value='note';activity.dispatchEvent(new win.Event('change'));
 expect(win.location.search).toBe('?filter=note');expect(category.value).toBe('');
 win.history.replaceState(null,'','?category=Fiqh&tag=fasting');win.dispatchEvent(new win.PopStateEvent('popstate'));
 expect(category.value).toBe('Fiqh');expect(activity.value).toBe('article');expect(tag.textContent).toBe('#fasting ×');
 win.close();
});
