'use strict';
jest.mock('../lib/Index',()=>({docsFromQuery:jest.fn()}));
const Index=require('../lib/Index');
const Search=require('../lib/Search');
const Articles=require('../lib/CommunitySearchIndex');
beforeEach(()=>{
 global.settings={search:{itemsPerPage:20}};global.books=[];global.surahs=[];
 Index.docsFromQuery.mockReset();
});
test('articles and library results use a single ES query, score order and total',async()=>{
 const docs=Object.assign([
 {doctype:'blog',id:1,title_en:'Mercy',article_text:'Published mercy',url:'/blog/mercy',_score:8},
 {doctype:'community',id:2,title_en:'A public article',article_text:'Mercy in life',url:'/community/p/example',_score:3}
 ],{total:87});
 Index.docsFromQuery.mockResolvedValue(docs);
 const result=await Search.a_searchText('mercy',[],20,{generalSearch:true,resultSize:20});
 expect(Index.docsFromQuery).toHaveBeenCalledTimes(1);
 const [indexes,query,offset,size,sort]=Index.docsFromQuery.mock.calls[0];
 expect(indexes).toBe('hadiths,toc,commentaries,sharhs,community_articles_v1');
 expect(offset).toBe(20);expect(size).toBe(20);expect(sort).toContain('_score DESC');
 expect(JSON.stringify(query)).toContain('article_text^5');
 expect(JSON.stringify(query)).not.toContain('wildcard');
 expect(result.map(r=>r.id)).toEqual([1,2]);expect(result.total).toBe(87);
});
test.each(['blog','community'])('explicit %s filter reaches ES without database searching',async type=>{
 Index.docsFromQuery.mockResolvedValue(Object.assign([],{total:0}));
 await Search.a_searchText('test',[type],0,{generalSearch:true});
 const query=Index.docsFromQuery.mock.calls[0][1];
 expect(query.bool.filter).toEqual([{bool:{should:[{terms:{doctype:[type]}}],minimum_should_match:1}}]);
});
test('article excerpts escape markup while preserving ES highlight markers',()=>{
 const item=Articles.formatResult({_highlight:{article_text:['<script>x</script> <i>mercy</i>']},article_text:'fallback'});
 expect(item.excerpt_html).toBe('&lt;script&gt;x&lt;/script&gt; <mark>mercy</mark>');
});
test('result template escapes author title and ordinary excerpt',async()=>{
 const html=await require('ejs').renderFile(require('path').join(__dirname,'../views/sub-views/blog_search_result.ejs'),{article:{url:'/blog/safe',author:'<script>x</script>',title_en:'<img src=x>',excerpt:'<script>alert(1)</script>'}});
 expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
});
