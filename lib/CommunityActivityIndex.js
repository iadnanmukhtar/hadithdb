'use strict';
const crypto = require('crypto');
const error = require('http-errors');
const epoch = "'1970-01-01 00:00:00.000'";
const identity = (table, alias) => `CASE WHEN CHAR_LENGTH(${alias}.user_uid) BETWEEN 1 AND 128 THEN CONVERT(${alias}.user_uid USING utf8mb4) COLLATE utf8mb4_bin ELSE CONCAT('legacy-reflection:',SHA2(CONCAT('${table}:',${alias}.id),256)) END`;
// Source keys are immutable identifiers, not copies of private content or public names.
const sources = [
  {table:'community_posts', key:'post', actor:a=>`${a}.author_uid`, kind:a=>`${a}.kind`, time:a=>`CASE WHEN ${a}.status='published' THEN COALESCE(${a}.published_at,${a}.updated_at) ELSE ${a}.updated_at END`, valid:a=>`${a}.status<>'deleted'`},
  {table:'community_comments', key:'comment', actor:a=>`${a}.author_uid`, kind:()=>"'comment'", time:a=>`${a}.created_at`, valid:a=>`${a}.deleted=0`},
  ...['hadiths_comments','blog_comments'].map(table=>({table,key:table,actor:a=>identity(table,a),kind:()=>"'comment'",time:a=>`${a}.createdAt`,valid:a=>`COALESCE(${a}.deleted,0)=0 AND ${a}.text IS NOT NULL AND TRIM(${a}.text)<>''`})),
  {table:'community_likes',key:'like',actor:a=>`${a}.user_uid`,kind:()=>"'like'",time:a=>`${a}.created_at`,valid:a=>`${a}.source IN ('post','comment')`},
  {table:'hadiths_likes',key:'hadith_like',actor:a=>identity('hadiths_likes',a),kind:()=>"'like'",time:a=>`${a}.createdAt`,valid:a=>`${a}.user_uid IS NOT NULL AND ${a}.user_uid<>''`},
  ...['hadiths_comments','blog_comments'].map(table=>({table:table+'_votes',key:table+'_like',actor:a=>identity(table+'_votes',a),kind:()=>"'like'",time:a=>`(SELECT l.created_at FROM community_likes l WHERE l.source='${table}' AND l.target_id=${a}.commentId AND l.user_uid=CONVERT(${a}.user_uid USING utf8mb4) COLLATE utf8mb4_bin LIMIT 1)`,valid:a=>`${a}.direction='up' AND ${a}.user_uid IS NOT NULL AND ${a}.user_uid<>''`})),
  {table:'community_reposts',key:'repost',actor:a=>`${a}.user_uid`,kind:()=>"'repost'",time:a=>`${a}.created_at`,valid:()=> '1=1'}
];
async function schema(q) {
  await q(`CREATE TABLE IF NOT EXISTS community_activity (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, source_id BIGINT UNSIGNED NOT NULL,
    actor_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    kind VARCHAR(12) CHARACTER SET ascii NOT NULL, activity_at DATETIME(3) NOT NULL,
    UNIQUE KEY activity_source (source,source_id),
    KEY activity_time (activity_at,id), KEY activity_actor_time (actor_uid,activity_at,id),
    KEY activity_kind_time (kind,activity_at,id), KEY activity_actor_kind_time (actor_uid,kind,activity_at,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS community_activity_state (id TINYINT PRIMARY KEY, version INT NOT NULL DEFAULT 0) ENGINE=InnoDB`);
}
function upsert(source, alias, from, live = false) {
  // Old votes have no timestamp column; retain known mirrored dates, otherwise
  // use the epoch for history and the actual mutation time for new events.
  const fallback = live && source.table.endsWith('_votes') ? 'CURRENT_TIMESTAMP(3)' : epoch;
  return `INSERT INTO community_activity (source,source_id,actor_uid,kind,activity_at)
    SELECT '${source.key}',${alias}.id,${source.actor(alias)},${source.kind(alias)},COALESCE(${source.time(alias)},${fallback}) ${from}
    WHERE ${source.valid(alias)} ON DUPLICATE KEY UPDATE actor_uid=VALUES(actor_uid),kind=VALUES(kind),activity_at=${source.table.endsWith('_votes') && !live ? `IF(VALUES(activity_at)=${epoch},activity_at,VALUES(activity_at))` : 'VALUES(activity_at)'}`;
}
function triggerSQL(source, event, name) {
  if (event === 'DELETE') return `CREATE TRIGGER ${name} AFTER DELETE ON ${source.table} FOR EACH ROW DELETE FROM community_activity WHERE source='${source.key}' AND source_id=OLD.id`;
  return `CREATE TRIGGER ${name} AFTER ${event} ON ${source.table} FOR EACH ROW BEGIN
    DELETE FROM community_activity WHERE source='${source.key}' AND ((source_id=NEW.id AND COALESCE((${source.valid('NEW')}),0)=0)${event === 'UPDATE' ? ' OR (source_id=OLD.id AND OLD.id<>NEW.id)' : ''});
    ${upsert(source,'NEW','',true)};
  END`;
}
async function install(q) {
  const tables = await q('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [sources.map(source=>source.table)]);
  const engines = new Map(tables.map(row=>[row.TABLE_NAME,row.ENGINE]));
  for (const source of sources) if (engines.get(source.table)?.toLowerCase() !== 'innodb') throw Error('Activity index requires an existing InnoDB source table: '+source.table);
  await schema(q);
  await q('INSERT INTO community_activity_state (id,version) VALUES (1,0) ON DUPLICATE KEY UPDATE version=0');
  const existing = new Set((await q('SHOW TRIGGERS')).map(row=>row.Trigger));
  for (const source of sources) for (const event of ['INSERT','UPDATE','DELETE']) {
    const name = `community_activity_v1_${source.table}_${event.toLowerCase()}`;
    if (!existing.has(name)) await q(triggerSQL(source,event,name));
  }
}
async function backfill(q, transaction, progress = ()=>{}) {
  for (const source of sources) {
    let after = 0, count = 0;
    while (true) {
      const batch = await transaction(async tx => {
        // Lock source rows while projecting them: a concurrent edit/delete must
        // run after this batch and its trigger then wins over the backfill.
        const rows = await tx(`SELECT id FROM ${source.table} WHERE id>? ORDER BY id LIMIT 500 FOR UPDATE`,[after]);
        if (!rows.length) return rows;
        const ids = rows.map(row=>row.id);
        await tx(`DELETE a FROM community_activity a JOIN ${source.table} s ON s.id=a.source_id WHERE a.source=? AND s.id IN (?) AND NOT (${source.valid('s')})`,[source.key,ids]);
        await tx(upsert(source,'s',`FROM ${source.table} s`).replace('WHERE '+source.valid('s'), 'WHERE s.id IN (?) AND '+source.valid('s')), [ids]);
        return rows;
      });
      if (!batch.length) break;
      after = batch[batch.length-1].id; count += batch.length;
      progress({source:source.key,processed:count});
    }
  }
  return transaction(async tx => {
    const report = await verify(tx);
    await tx('UPDATE community_activity_state SET version=1 WHERE id=1');
    return report;
  });
}

async function verify(q) {
  const report = {};
  for (const source of sources) {
    const timeMismatch = source.table.endsWith('_votes') ? '' : ` OR NOT(a.activity_at <=> COALESCE(${source.time('s')},${epoch}))`;
    const [coverage] = await q(`SELECT COUNT(*) AS eligible,COALESCE(SUM(a.id IS NULL),0) AS missing,
      COALESCE(SUM(a.id IS NOT NULL AND (NOT(a.actor_uid <=> ${source.actor('s')}) OR NOT(a.kind <=> ${source.kind('s')})${timeMismatch})),0) AS mismatched
      FROM ${source.table} s LEFT JOIN community_activity a ON a.source=? AND a.source_id=s.id WHERE ${source.valid('s')}`, [source.key]);
    const [stale] = await q(`SELECT COUNT(*) AS stale FROM community_activity a LEFT JOIN ${source.table} s ON s.id=a.source_id
      WHERE a.source=? AND (s.id IS NULL OR COALESCE((${source.valid('s')}),0)=0)`, [source.key]);
    report[source.key] = {...coverage,...stale};
    if (Number(coverage.missing) || Number(coverage.mismatched) || Number(stale.stale)) throw Error('Activity-index verification failed for '+source.key+': '+JSON.stringify(report[source.key]));
  }
  return report;
}
function scopeKey({scope,kind,user,author}) { return crypto.createHash('sha256').update(JSON.stringify([scope,kind,user?.uid || '',author?.uid||''])).digest('hex').slice(0,24); }
function encode(row, scope) {return Buffer.from(JSON.stringify({v:1,t:row.cursor_time,i:String(row.id),s:scope})).toString('base64url');}
function decode(value, scope) {
  try {
    if (typeof value !== 'string' || value.length > 400 || !/^[\w-]+$/.test(value)) throw Error();
    const c=JSON.parse(Buffer.from(value,'base64url').toString());
    if(c.v!==1 || c.s!==scope || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(c.t) || !/^[1-9]\d{0,14}$/.test(c.i))throw Error();
    if (new Date(c.t.replace(' ','T')+'Z').toISOString().slice(0,23).replace('T',' ') !== c.t) throw Error();
    return c;
  }catch(_){throw error(400,'Invalid feed cursor. Refresh the feed.');}
}
function visibility(scope) {
  const publicPost = scope==='mine' ? "p.status<>'deleted'" : "p.status='published'";
  const target = alias => `(( ${alias}.source='post' AND EXISTS(SELECT 1 FROM community_posts p WHERE p.id=${alias}.target_id AND p.status='published'))
    OR (${alias}.source='comment' AND EXISTS(SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=${alias}.target_id AND c.deleted=0 AND p.status='published'))
    OR (${alias}.source='hadiths_comments' AND EXISTS(SELECT 1 FROM hadiths_comments c WHERE c.id=${alias}.target_id AND COALESCE(c.deleted,0)=0 AND TRIM(COALESCE(c.text,''))<>''))
    OR (${alias}.source='blog_comments' AND EXISTS(SELECT 1 FROM blog_comments c WHERE c.id=${alias}.target_id AND COALESCE(c.deleted,0)=0 AND TRIM(COALESCE(c.text,''))<>'')))`;
  return `((a.source='post' AND EXISTS(SELECT 1 FROM community_posts p WHERE p.id=a.source_id AND ${publicPost}))
    OR (a.source='comment' AND EXISTS(SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=a.source_id AND c.deleted=0 AND p.status='published'))
    OR (a.source='hadiths_comments' AND EXISTS(SELECT 1 FROM hadiths_comments c WHERE c.id=a.source_id AND COALESCE(c.deleted,0)=0 AND TRIM(COALESCE(c.text,''))<>''))
    OR (a.source='blog_comments' AND EXISTS(SELECT 1 FROM blog_comments c WHERE c.id=a.source_id AND COALESCE(c.deleted,0)=0 AND TRIM(COALESCE(c.text,''))<>''))
    OR (a.source='hadith_like' AND EXISTS(SELECT 1 FROM hadiths_likes l WHERE l.id=a.source_id AND l.user_uid IS NOT NULL AND l.user_uid<>''))
    OR (a.source='like' AND EXISTS(SELECT 1 FROM community_likes l WHERE l.id=a.source_id AND ${target('l')}))
    OR (a.source='repost' AND EXISTS(SELECT 1 FROM community_reposts r WHERE r.id=a.source_id AND ${target('r')}))
    OR (a.source='hadiths_comments_like' AND EXISTS(SELECT 1 FROM hadiths_comments_votes v JOIN hadiths_comments c ON c.id=v.commentId WHERE v.id=a.source_id AND v.direction='up' AND COALESCE(c.deleted,0)=0))
    OR (a.source='blog_comments_like' AND EXISTS(SELECT 1 FROM blog_comments_votes v JOIN blog_comments c ON c.id=v.commentId WHERE v.id=a.source_id AND v.direction='up' AND COALESCE(c.deleted,0)=0)))`;
}
async function page(q, options) {
  let state;
  try {state=await q('SELECT version FROM community_activity_state WHERE id=1');}
  catch(err){if(err.code==='ER_NO_SUCH_TABLE')state=[];else throw err;}
  if(state[0]?.version!==1) {
    if(options.cursor)throw error(409,'The feed changed. Refresh to continue.');
    return null;
  }
  const {scope,kind,user,author,cursor,offset=0}=options;
  const key=scopeKey(options),params=[],where=[visibility(scope)];
  where.push(require('./CommunityVisibility').predicate('a.source','a.source_id','a.actor_uid',user?.uid,params));
  if(scope==='mine'){where.push('a.actor_uid=?');params.push(user.uid);}
  if(scope==='following'){where.push('EXISTS(SELECT 1 FROM community_follows f WHERE f.author_uid=a.actor_uid AND f.follower_uid=?)');params.push(user.uid);}
  if(author){where.push('a.actor_uid=?');params.push(author.uid);}
  if(kind==='draft')where.push(scope==='mine'?"a.source='post' AND EXISTS(SELECT 1 FROM community_posts p WHERE p.id=a.source_id AND p.status='draft')":'1=0');
  else if(kind==='hidden')where.push(scope==='mine'?"((a.source='post' AND EXISTS(SELECT 1 FROM community_posts p WHERE p.id=a.source_id AND p.status='private')) OR "+require('./CommunityVisibility').hiddenPredicate('a.source','a.source_id')+")":'1=0');
  else if(kind!=='all'){where.push('a.kind=?');params.push(kind);}
  if(kind==='note')where.push("a.source='post' AND NOT EXISTS (SELECT 1 FROM community_hadith_posts hp WHERE hp.post_id=a.source_id)");
  if(cursor){const c=decode(cursor,key);where.push('(a.activity_at<? OR (a.activity_at=? AND a.id<?))');params.push(c.t,c.t,c.i);}
  // OFFSET is a bounded compatibility path for existing API clients; the UI uses cursors.
  const rows=await q(`SELECT a.id,a.source,a.source_id,a.activity_at,DATE_FORMAT(a.activity_at,'%Y-%m-%d %H:%i:%s.%f') AS raw_time FROM community_activity a
    WHERE ${where.join(' AND ')} ORDER BY a.activity_at DESC,a.id DESC LIMIT 21 OFFSET ?`,[...params,cursor?0:offset]);
  for(const row of rows)row.cursor_time=row.raw_time.slice(0,23);
  const visible=rows.slice(0,20),ids={};
  for(const row of visible)(ids[row.source] ||= []).push(row.source_id);
  return {rows:visible,ids,hasMore:rows.length>20,cursor:visible.length?encode(visible[visible.length-1],key):null};
}
module.exports={sources,schema,install,backfill,triggerSQL,upsert,page,decode,encode,scopeKey,visibility,verify};
