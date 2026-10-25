'use strict';
jest.mock('../lib/Community',()=>({ensure:jest.fn(async()=>{}),sql:jest.fn()}));
const Community=require('../lib/Community');
const Blog=require('../lib/CommunityBlogSearch');
let rows,bodies;
beforeEach(()=>{rows=[];bodies=[];Community.sql.mockImplementation(async sql=>sql.includes('public_markdown')?bodies:rows);});
function article(id,title,body){rows.push({id,public_title:title,version:1,updated_at:new Date(),published_at:'2020-01-01',name:'Author',handle:'author',slug:'Original path '+id});bodies.push({id,public_markdown:body});}
test('finds public title and full body with Arabic diacritics, preserving legacy URLs',async()=>{
 article(1,'Duas of Protection','Opening paragraph. '.repeat(100)+'الصَّلَاةُ and wellness');
 expect((await Blog.search('duas protection'))[0].url).toBe('/blog/Original%20path%201');
 expect((await Blog.search('الصلاة'))[0].id).toBe(1);
 expect((await Blog.search('wellness'))[0].excerpt).toContain('wellness');
 expect(await Blog.search('missing')).toEqual([]);
});
test('removes hidden or unfeatured articles immediately despite cached body',async()=>{
 article(2,'Needle','Public needle');expect(await Blog.search('needle')).toHaveLength(1);
 rows=[];bodies=[];expect(await Blog.search('needle')).toEqual([]);
});
test('refreshes changed published snapshots and never uses draft fields',async()=>{
 article(3,'Published','Public needle');rows[0].title='Private draft';rows[0].markdown='secret-draft';
 expect(await Blog.search('secret-draft')).toEqual([]);
 expect(await Blog.search('needle')).toHaveLength(1);
 rows[0].version=2;bodies[0].public_markdown='Replacement';expect(await Blog.search('needle')).toEqual([]);
 expect(await Blog.search('replacement')).toHaveLength(1);
});
test('merged pagination preserves all corpus items and totals across boundary',async()=>{
 for(let i=10;i<15;i++)article(i,'Needle '+i,'Body');
 const corpus=Array.from({length:8},(_,i)=>({id:100+i}));
 const fetchCorpus=jest.fn(async(offset,size)=>Object.assign(corpus.slice(offset,offset+size),{total:corpus.length}));
 const pages=[];
 for(let offset=0;offset<13;offset+=4){const page=await Blog.merge('needle',offset,5,fetchCorpus);expect(page.total).toBe(13);pages.push(...page.slice(0,4));}
 expect(pages).toHaveLength(13);expect(new Set(pages.map(i=>i.id)).size).toBe(13);
 expect(pages.filter(p=>p.id>=100).map(p=>p.id)).toEqual(corpus.map(p=>p.id));
});
test('result template escapes author title and content',async()=>{
 const html=await require('ejs').renderFile(require('path').join(__dirname,'../views/sub-views/blog_search_result.ejs'),{article:{url:'/blog/safe',author:'<script>x</script>',title_en:'<img src=x>',excerpt:'<script>alert(1)</script>'}});
 expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
});
