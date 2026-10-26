'use strict';
const crypto = require('crypto');
const C = require('./Community');
function snapshot(action, item) {
  const fields = action === 'title' ? ['title','title_en'] : ['title','title_en','chain','body','footnote','chain_en','body_en','footnote_en'];
  return fields.map(key => String(item?.[key] || '').trim());
}
function escapeMarkdown(value) { return String(value || '').replace(/[\\`*_{}\[\]<>]/g, '\\$&'); }
// Called only after an authenticated administrator successfully saves a hadith.
function entry(user, action, after) {
  const values = snapshot(action, after);
  const hadithId = C.id(after.hId);
  const ref = String(after.ref || (after.book_alias && after.num ? after.book_alias+':'+after.num : ''));
  if (!/^[a-z0-9_-]+:[\w.:-]+$/i.test(ref)) throw new Error('Missing canonical hadith reference');
  const verb = action === 'title' ? 'Titled' : 'Revised';
  const title = `${verb} ${ref}`;
  const heading = after.title_en || after.title || '';
  const markdown = `${verb} [${escapeMarkdown(ref)}](/${encodeURIComponent(ref).replace(/%3A/gi,':')})` +
    (heading ? '\n\n'+escapeMarkdown(heading) : '') +
    (action === 'revise' && after.body_en ? '\n\n'+escapeMarkdown(after.body_en) : '');
  const eventKey = crypto.createHash('sha256').update(JSON.stringify([user.uid,hadithId,action,values])).digest('hex');
  return {eventKey,title,markdown};
}
async function insert(q, user, data, publishedAt = null) {
  const {eventKey,title,markdown}=data;
  const claim = await q('INSERT IGNORE INTO community_hadith_posts (event_key) VALUES (?)',[eventKey]);
  if (!claim.affectedRows) return null;
  const saved = await q(`INSERT INTO community_posts
    (author_uid,kind,title,subtitle,markdown,status,public_title,public_subtitle,public_markdown,public_tags,published_at,created_at,updated_at)
    VALUES (?,'note',?,'',?,'published',?,'',?,'',COALESCE(?,CURRENT_TIMESTAMP(3)),COALESCE(?,CURRENT_TIMESTAMP(3)),COALESCE(?,CURRENT_TIMESTAMP(3)))`,[user.uid,title,markdown,title,markdown,publishedAt,publishedAt,publishedAt]);
  await q("INSERT INTO community_revisions (post_id,version,title,subtitle,markdown,tags,created_at) VALUES (?,1,?,'',?,'',COALESCE(?,CURRENT_TIMESTAMP(3)))",[saved.insertId,title,markdown,publishedAt]);
  await q('UPDATE community_hadith_posts SET post_id=? WHERE event_key=?',[saved.insertId,eventKey]);
  return saved.insertId;
}
async function publish(user, action, before, after) {
  if (!user?.uid || !['title','revise'].includes(action) || !before || !after) return null;
  if (JSON.stringify(snapshot(action,before)) === JSON.stringify(snapshot(action,after))) return null;
  const data=entry(user,action,after);
  await C.authorFor(user);
  return C.transaction(q=>insert(q,user,data));
}
async function backfillTitles(user, rows, apply = false, progress = ()=>{}) {
  if (!user?.uid) throw new Error('An existing author is required');
  const entries=rows.filter(row=>String(row.title_en||'').trim()).map(row=>{
    const date=new Date(row.lastmod);
    if(!row.lastmod || !Number.isFinite(+date)) throw new Error('Missing historical date for hadith '+row.hId);
    return {data:entry(user,'title',row),date};
  });
  const result={candidates:entries.length,created:0,existing:0};
  if (!apply) return result;
  await C.ensure();
  if (!(await C.sql('SELECT uid FROM community_authors WHERE uid=?',[user.uid])).length) throw new Error('Author not found');
  for(let offset=0;offset<entries.length;offset+=100){
    const batch=await C.transaction(async q=>{
      let created=0;
      for(const item of entries.slice(offset,offset+100)) if(await insert(q,user,item.data,item.date))created++;
      return created;
    });
    result.created+=batch;result.existing+=Math.min(100,entries.length-offset)-batch;
    progress({...result,processed:Math.min(offset+100,entries.length)});
  }
  return result;
}
async function decorate(items) {
  const candidates=items.filter(item=>item.activity==='post' && item.kind==='note' && /^(Titled|Revised) /.test(item.title) && (!item.status || item.status==='published'));
  if(!candidates.length)return;
  const rows=await C.sql('SELECT p.id,p.public_markdown FROM community_hadith_posts e JOIN community_posts p ON p.id=e.post_id WHERE p.id IN (?) AND p.status=\'published\'',[candidates.map(item=>item.id)]);
  const byId=new Map(rows.map(row=>[String(row.id),row]));
  for(const item of candidates){
    const row=byId.get(String(item.id));if(!row)continue;
    const $=require('cheerio').load(C.content(row.public_markdown).html);
    const paragraphs=$('p'),source=paragraphs.first().find('a').first();
    const title=paragraphs.eq(1).text().trim() || source.text();
    if(!title || !/^\/[a-z0-9_-]+:[\w.:%-]+$/i.test(source.attr('href')||''))continue;
    item.canEdit=false;item.microinteraction=/^Revised /.test(item.title)?'revision':'title';item.hadithTitle=title;item.hadithRef=source.text();item.hadithUrl=source.attr('href');
  }
}
module.exports={publish,backfillTitles,decorate};
