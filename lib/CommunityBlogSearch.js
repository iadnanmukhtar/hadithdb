'use strict';
const Community=require('./Community');
const {load}=require('cheerio');
const md=require('markdown-it')({html:true});
const cache=new Map();
function normalize(value) {
  return String(value||'').normalize('NFKD').replace(/[\p{M}\u0640]/gu,'').toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي');
}
async function search(query) {
  const terms=[...new Set(normalize(query).match(/[\p{L}\p{N}]+/gu)||[])];
  if(terms.join('').length<3 || String(query).startsWith('='))return [];
  await Community.ensure();
  // Recheck publication and Blog designation on every request, even with cached text.
  const rows=await Community.sql(`SELECT p.id,p.public_title,p.public_subtitle,p.version,p.updated_at,p.published_at,a.name,a.handle,l.slug,l.attributes_json
    FROM community_blog_posts b JOIN community_posts p ON p.id=b.post_id JOIN community_authors a ON a.uid=p.author_uid
    LEFT JOIN community_blog_imports l ON l.post_id=p.id WHERE p.status='published' AND p.kind='article'`);
  const visible=new Set(rows.map(r=>String(r.id)));
  for(const id of cache.keys())if(!visible.has(id))cache.delete(id);
  const stale=rows.filter(r=>cache.get(String(r.id))?.version!==`${r.version}:${new Date(r.updated_at).getTime()}`);
  if(stale.length){
    const bodies=await Community.sql("SELECT id,public_markdown FROM community_posts WHERE status='published' AND id IN (?)",[stale.map(r=>r.id)]);
    for(const row of stale){const body=bodies.find(b=>String(b.id)===String(row.id));if(!body)continue;
      const $=load(md.render(body.public_markdown||''));$('script,style').remove();
      const text=$.text().replace(/\s+/g,' ').trim();
      cache.set(String(row.id),{version:`${row.version}:${new Date(row.updated_at).getTime()}`,text,normalized:normalize(text)});
    }
  }
  const found=[];
  for(const row of rows){
    const body=cache.get(String(row.id));if(!body)continue;
    const meta=row.attributes_json ? JSON.parse(row.attributes_json):{};
    const title=normalize(row.public_title),description=normalize(row.public_subtitle ?? meta.subtitle ?? meta.description ?? '');
    const haystack=title+' '+description+' '+body.normalized;
    if(!terms.every(term=>haystack.includes(term)))continue;
    const score=terms.reduce((n,term)=>n+(title.includes(term)?10:description.includes(term)?3:1),0);
    const first=terms.map(t=>body.normalized.indexOf(t)).filter(i=>i>=0).sort((a,b)=>a-b)[0]||0;
    const start=Math.max(0,first-90),snippet=body.text.slice(start,start+280);
    found.push({doctype:'blog',id:row.id,title_en:row.public_title,author:row.name,publishedAt:row.published_at,
      url:row.slug?'/blog/'+encodeURIComponent(row.slug):`/community/@${row.handle}/${row.id}`,
      excerpt:(start?'…':'')+snippet+(start+280<body.text.length?'…':''),score});
  }
  return found.sort((a,b)=>b.score-a.score || new Date(b.publishedAt)-new Date(a.publishedAt) || b.id-a.id);
}
async function merge(query,offset,size,searchCorpus){
  const blogs=await search(query);
  if(!blogs.length)return searchCorpus(offset,size);
  const blogPage=blogs.slice(offset,offset+size);
  const corpus=await searchCorpus(Math.max(0,offset-blogs.length),Math.max(1,size-blogPage.length));
  const result=blogPage.concat(corpus.slice(0,size-blogPage.length));
  result.total=blogs.length+(Number.isFinite(corpus.total)?corpus.total:corpus.length);
  return result;
}
module.exports={search,merge,normalize};
