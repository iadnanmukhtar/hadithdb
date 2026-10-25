'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fm = require('front-matter');
const {load}=require('cheerio');
const Community = require('./Community');
const url = slug => '/blog/' + encodeURIComponent(slug);
function sources(dir) {
  return fs.readdirSync(dir).filter(file => file.endsWith('.md')).sort().map(file => {
    const raw = fs.readFileSync(path.join(dir,file),'utf8'), {attributes,body} = fm(raw);
    const published = new Date(attributes.published), updated = new Date(fs.statSync(path.join(dir,file)).mtimeMs);
    const hidden = attributes.hidden === true || attributes.hidden === 'true';
    if (!hidden && (!attributes.title || !body.trim() || !Number.isFinite(+published))) throw new Error('Invalid published blog metadata: '+file);
    return {slug:file.slice(0,-3),raw,body,attributes,published,updated,hidden,hash:crypto.createHash('sha256').update(raw).digest('hex')};
  });
}
async function records() {
  await Community.ensure();
  return Community.sql(`SELECT l.post_id,l.slug,l.attributes_json,l.source_sha256, p.status,p.public_title,p.public_subtitle,p.public_markdown,p.published_at,p.updated_at,
    EXISTS(SELECT 1 FROM community_blog_posts b WHERE b.post_id=p.id) AS featured
    FROM community_blog_imports l JOIN community_posts p ON p.id=l.post_id`);
}
function attributes(row) {
  return {...JSON.parse(row.attributes_json),title:row.public_title,subtitle:row.public_subtitle ?? JSON.parse(row.attributes_json).subtitle,published:new Date(row.published_at)};
}
async function decorate(items) {
  const ids = items.filter(i=>i.activity==='post' || !i.activity && i.kind==='article').map(i=>i.id);
  if (!ids.length) return;
  const rows = await Community.sql('SELECT post_id,slug,attributes_json FROM community_blog_imports WHERE post_id IN (?)',[ids]);
  const imports = new Map(rows.map(r=>[String(r.post_id),r]));
  for (const item of items) {
    const row=imports.get(String(item.id));
    if (!row || !(item.activity==='post' || !item.activity && item.kind==='article')) continue;
    item.url=url(row.slug);
    const meta=JSON.parse(row.attributes_json);
    if(meta.published && Number.isFinite(+new Date(meta.published))) item.publicationDate=new Date(meta.published).toISOString().slice(0,10);
    const $=load('<div></div>',null,false), root=$('div');
    const card=$('<a class="community-link-card community-blog-preview"></a>').attr('href',item.url);
    let cover=String(meta.cover||'/static/img/pearls_of_the_deep.jpg').trim();
    if (!/^(?:https?:\/\/|\/(?!\/))/i.test(cover)) cover='/blog/'+cover;
    if (/^(?:https?:\/\/|\/(?!\/))/i.test(cover)) card.append($('<img>').attr({src:encodeURI(cover).replace(/%25([0-9a-f]{2})/gi,'%$1'),alt:meta.title||item.title||'',loading:'lazy'}));
    item.coverUrl=card.find('img').attr('src')||null;
    const copy=$('<span class="community-link-copy"></span>');
    copy.append($('<small></small>').text('Blog'),$('<strong></strong>').text(item.title||meta.title));
    if(item.subtitle)copy.append($('<span></span>').text(item.subtitle));
    card.append(copy);root.append($('<div class="community-link-preview"></div>').append(card));
    const video=require('./CommunityMedia').urlFor(meta.video);
    if(video)root.append($('<div class="community-link-preview"></div>').attr('data-preview-url',video).append($('<a></a>').attr('href',video).text('Watch video')));
    root.append(item.mediaHtml||'');
    root.find('img').each((_,el)=>{const src=$(el).attr('src')||'';if(/^Attachments\//i.test(src))$(el).attr('src','/blog/'+src);});
    const seen=new Set();root.find('[data-preview-url]').each((_,el)=>{const href=$(el).attr('data-preview-url');if(seen.has(href))$(el).remove();else seen.add(href);});
    item.mediaHtml=root.html();
  }
}
async function migrate(dir, authorUid, apply=false) {
  await Community.ensure();
  const author=(await Community.sql('SELECT uid,name,handle FROM community_authors WHERE uid=?',[authorUid]))[0];
  if (!author) throw new Error('Confirmed author account required.');
  const input=sources(dir), existing=await records(), bySlug=new Map(existing.map(r=>[r.slug,r]));
  for (const source of input) {
    const prior=bySlug.get(source.slug);
    if (prior && prior.source_sha256!==source.hash) throw new Error('Source changed since import: '+source.slug+'; refusing to overwrite article edits.');
  }
  const pending=input.filter(s=>!s.hidden && !bySlug.has(s.slug));
  const result={author:author.name,handle:author.handle,total:input.length,hidden:input.filter(s=>s.hidden).map(s=>s.slug),existing:existing.length,imported:[],pending:pending.map(s=>({slug:s.slug,published:s.published,url:url(s.slug)}))};
  if (!apply) return result;
  await Community.transaction(async q=>{
    for (const source of pending) {
      const {insertId}=await q(`INSERT INTO community_posts (author_uid,kind,title,subtitle,markdown,status,public_title,public_subtitle,public_markdown,public_tags,published_at,updated_at,created_at) VALUES (?,'article',?,?,?,'published',?,?,?,'',?,?,?)`,[authorUid,source.attributes.title,source.attributes.subtitle || '',source.body,source.attributes.title,source.attributes.subtitle || '',source.body,source.published,source.updated,source.published]);
      await q('INSERT INTO community_revisions (post_id,version,title,subtitle,markdown,tags,created_at) VALUES (?,1,?,?,?,?,?)',[insertId,source.attributes.title,source.attributes.subtitle || '',source.body,'',source.updated]);
      await q('INSERT INTO community_blog_posts (post_id,marked_by,created_at) VALUES (?,?,?)',[insertId,authorUid,source.published]);
      await q('INSERT INTO community_blog_imports (post_id,slug,attributes_json,source_sha256,source_markdown) VALUES (?,?,?,?,?)',[insertId,source.slug,JSON.stringify(source.attributes),source.hash,source.raw]);
      result.imported.push({id:insertId,slug:source.slug});
    }
  });
  return result;
}
async function publicUrls() {
  await Community.ensure();
  const rows=await Community.sql("SELECT p.id,a.handle,l.slug FROM community_blog_posts b JOIN community_posts p ON p.id=b.post_id JOIN community_authors a ON a.uid=p.author_uid LEFT JOIN community_blog_imports l ON l.post_id=p.id WHERE p.status='published' AND p.kind='article'");
  return rows.map(row=>row.slug?url(row.slug):'/community/@'+row.handle+'/'+row.id);
}
module.exports={sources,records,attributes,decorate,migrate,url,publicUrls};
