'use strict';
const crypto = require('crypto');
const {promisify} = require('util');
const error = require('http-errors');
const C = require('./Community');
const Sources = require('./ActivityPubSources');
const Http = require('./ActivityPubHttp');
const CONTEXT = 'https://www.w3.org/ns/activitystreams';
const PUBLIC = CONTEXT + '#Public';
let ready;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function enabled() { return process.env.ACTIVITYPUB_ENABLED === '1'; }
function origin() {
  const value = process.env.ACTIVITYPUB_ORIGIN || global.settings?.site?.url;
  const url = Http.url(value);
  if (url.pathname !== '/' || url.search) throw new Error('ACTIVITYPUB_ORIGIN must be an HTTPS origin without a path.');
  return url.origin;
}
const actorUrl = id => origin() + '/activitypub/actors/' + id;
const absolute = path => new URL(path, origin()).href;
async function ensure() {
  if (!ready) ready = (async () => {
    await C.ensure();
    const schema = require('fs').readFileSync(require('path').join(__dirname,'../data/migrations/activitypub.sql'),'utf8');
    for (const statement of schema.split(';').map(s=>s.trim()).filter(Boolean)) await C.sql(statement);
  })().catch(err => { ready = null; throw err; });
  return ready;
}
async function actorFor(author, q = C.sql) {
  let row = (await q('SELECT * FROM activitypub_actors WHERE author_uid=?',[author.uid]))[0];
  if (!row) {
    const keys = await promisify(crypto.generateKeyPair)('rsa', {modulusLength:2048,
      publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    await q('INSERT IGNORE INTO activitypub_actors (id,author_uid,public_key,private_key) VALUES (?,?,?,?)',
      [crypto.randomBytes(16).toString('hex'),author.uid,keys.publicKey,keys.privateKey]);
    row = (await q('SELECT * FROM activitypub_actors WHERE author_uid=?',[author.uid]))[0];
  }
  return {...row, url:actorUrl(row.id)};
}
async function actorById(id) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw error(404);
  await ensure();
  const row = (await C.sql('SELECT * FROM activitypub_actors WHERE id=?',[id]))[0];
  if (!row) throw error(404);
  return {...row,url:actorUrl(row.id),author:await Sources.author(C.sql,row.author_uid)};
}
function actorDocument(actor) {
  const a = actor.author;
  return {'@context':[CONTEXT,'https://w3id.org/security/v1'],id:actor.url,type:'Person',
    preferredUsername:a?.handle || 'unavailable',name:a ? require('./CommunityName')(a.name,a.custom_name) : 'Unavailable author',
    ...(a ? {url:absolute('/community/@'+a.handle)} : {}),
    inbox:actor.url+'/inbox',outbox:actor.url+'/outbox',followers:actor.url+'/followers',
    manuallyApprovesFollowers:false,
    publicKey:{id:actor.url+'#main-key',owner:actor.url,publicKeyPem:actor.public_key}};
}
async function webfinger(resource) {
  if (typeof resource !== 'string') throw error(400,'Missing resource.');
  const match = resource.match(/^acct:([a-z0-9_.-]{3,40})@([^/@]+)$/);
  if (!match || match[2].toLowerCase() !== new URL(origin()).host) throw error(404);
  await ensure();
  const author = (await C.sql('SELECT uid,handle,name,custom_name,profile_visibility FROM community_authors WHERE handle=?',[match[1]]))[0];
  if (!Sources.eligible(author)) throw error(404);
  const actor = await actorFor(author);
  return {subject:'acct:'+author.handle+'@'+new URL(origin()).host,aliases:[actor.url,absolute('/community/@'+author.handle)],
    links:[{rel:'self',type:Http.TYPE,href:actor.url},{rel:'http://webfinger.net/rel/profile-page',type:'text/html',href:absolute('/community/@'+author.handle)}]};
}
async function state(q, source, id) {
  return (await q('SELECT * FROM activitypub_objects WHERE source=? AND source_id=?',[source,id]))[0];
}
function parse(row) { return row ? JSON.parse(row.activity_json) : null; }
async function reference(q, ref) {
  if (ref.url && !ref.source) return absolute(ref.url);
  const saved = await state(q,ref.source,ref.id);
  if (saved?.active) return parse(saved).object.id;
  const item = await Sources.read(q,ref.source,ref.id);
  return item ? absolute(item.url) : (ref.url ? absolute(ref.url) : null);
}
async function object(item, actor, previous, q = C.sql) {
  const saved = parse(previous);
  const id = previous?.active && saved?.type === 'Create' ? saved.object.id :
    absolute(`/activitypub/objects/${item.source}/${item.id}/${crypto.randomBytes(16).toString('hex')}`);
  const published = item.published && Number.isFinite(+new Date(item.published)) ? new Date(item.published).toISOString() :
    saved?.object?.published || saved?.published || new Date(0).toISOString();
  const audience = {to:[PUBLIC],cc:[actor.url+'/followers']};
  if (item.reaction) return {type:item.reaction,actor:actor.url,object:await reference(q,item.target),published,...audience};
  const reply = item.reply ? await reference(q,item.reply) : null;
  const content = (item.title ? '<p><strong>'+escape(item.title)+'</strong></p>' : '') +
    (item.subtitle ? '<p>'+escape(item.subtitle)+'</p>' : '') + Sources.html(item.markdown,origin());
  return {id,type:'Note',attributedTo:actor.url,url:absolute(item.url),content,published,...audience,
    ...(reply ? {inReplyTo:reply} : {}),
    ...(item.cover ? {attachment:[{type:'Document',url:absolute(item.cover),name:item.title || 'Cover image'}]} : {})};
}
function escape(value) { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function enqueue(q, actorId, activity, source = null, id = null) {
  if (source) await q('INSERT INTO activitypub_activities (id,actor_id,source,source_id,activity_json) VALUES (?,?,?,?,?)',
    [activity.id.split('/').pop(),actorId,source,id,JSON.stringify(activity)]);
  await q(`INSERT INTO activitypub_deliveries (actor_id,remote_hash,inbox,activity_json,source,source_id)
    SELECT actor_id,remote_hash,inbox,?,?,? FROM activitypub_followers WHERE actor_id=?`,[JSON.stringify(activity),source,id,actorId]);
}
async function syncOne(q, source, id) {
  const previous = await state(q,source,id), item = await Sources.read(q,source,id);
  if (!item && !previous?.active) return false;
  const activityId = absolute('/activitypub/activities/'+crypto.randomBytes(16).toString('hex'));
  if (!item) {
    const old = parse(previous);
    const activity = {'@context':CONTEXT,id:activityId,actor:actorUrl(previous.actor_id),to:[PUBLIC],cc:[actorUrl(previous.actor_id)+'/followers'],
      type:old.type === 'Create' ? 'Delete' : 'Undo',object:old.type === 'Create' ? {id:old.object.id,type:'Tombstone'} : old};
    await enqueue(q,previous.actor_id,activity,source,id);
    await q('UPDATE activitypub_objects SET active=0 WHERE source=? AND source_id=?',[source,id]);
    return true;
  }
  // Ensure Announce and Like targets are actual dereferenceable objects, even
  // when the source table scan has not reached the original yet.
  if (item.target?.source) await syncOne(q,item.target.source,item.target.id);
  const actor = await actorFor(item.author,q);
  const value = await object(item,actor,previous?.actor_id === actor.id ? previous : null,q);
  const fingerprint = hash(JSON.stringify(value));
  if (previous?.active && previous.fingerprint === fingerprint && previous.actor_id === actor.id) return false;
  // Identity merges must retract the old attribution before republishing.
  if (previous?.active && previous.actor_id !== actor.id) {
    const old = parse(previous);
    await enqueue(q,previous.actor_id,{'@context':CONTEXT,id:activityId+'-old',actor:actorUrl(previous.actor_id),to:[PUBLIC],
      type:old.type === 'Create' ? 'Delete' : 'Undo',object:old.type === 'Create' ? {id:old.object.id,type:'Tombstone'} : old},source,id);
  }
  const updating = previous?.active && previous.actor_id === actor.id;
  const activity = item.reaction ? {'@context':CONTEXT,id:activityId,...value} :
    {'@context':CONTEXT,id:activityId,type:updating?'Update':'Create',actor:actor.url,to:[PUBLIC],cc:[actor.url+'/followers'],
      object:{...value,...(updating?{updated:new Date().toISOString()}:{})}};
  if (item.reaction && updating) {
    await enqueue(q,previous.actor_id,{'@context':CONTEXT,id:activityId+'-undo',type:'Undo',actor:actor.url,to:[PUBLIC],object:parse(previous)},source,id);
  }
  await enqueue(q,actor.id,activity,source,id);
  // Store a Create-shaped snapshot for the public outbox and future Delete,
  // while preserving the stable object ID across edits.
  const snapshot = item.reaction ? activity : {...activity,id:updating?parse(previous).id:activity.id,type:'Create'};
  await q(`INSERT INTO activitypub_objects (source,source_id,actor_id,fingerprint,activity_json,sort_at,active) VALUES (?,?,?,?,?,?,1)
    ON DUPLICATE KEY UPDATE actor_id=VALUES(actor_id),fingerprint=VALUES(fingerprint),activity_json=VALUES(activity_json),sort_at=VALUES(sort_at),active=1`,
    [source,id,actor.id,fingerprint,JSON.stringify(snapshot),new Date(value.published)]);
  return true;
}
async function publicObject(source,id,token) {
  if (!Sources.tables[source] || !/^[1-9]\d{0,14}$/.test(String(id)) || !/^[a-f0-9]{32}$/.test(token)) throw error(404);
  await ensure();
  const saved = await state(C.sql,source,id), activity = parse(saved);
  if (!saved || activity.type !== 'Create') throw error(404);
  if (!saved.active || !activity.object.id.endsWith('/'+token)) throw error(410);
  const item = await Sources.read(C.sql,source,id);
  if (!item) throw error(410);
  const actor = await actorFor(item.author);
  if (actor.id !== saved.actor_id) throw error(410);
  return {'@context':CONTEXT,...await object(item,actor,saved),...(activity.object.updated?{updated:activity.object.updated}:{})};
}
async function outbox(actor, offset) {
  const base = actor.url+'/outbox';
  if (!actor.author) return {'@context':CONTEXT,id:base,type:'OrderedCollection',totalItems:0};
  if (offset === undefined) return {'@context':CONTEXT,id:base,type:'OrderedCollection',first:base+'?page=0'};
  const start = Number(offset);
  if (!/^\d+$/.test(String(offset)) || !Number.isSafeInteger(start) || start > 1000000) throw error(400,'Invalid page.');
  const rows = await C.sql('SELECT * FROM activitypub_objects WHERE actor_id=? AND active=1 ORDER BY sort_at DESC,source_id DESC,source LIMIT 21 OFFSET ?',[actor.id,start]);
  const items = [];
  for (const saved of rows.slice(0,20)) {
    const item = await Sources.read(C.sql,saved.source,saved.source_id);
    if (!item || item.author.uid !== actor.author_uid) continue;
    const activity = parse(saved), value = await object(item,actor,saved);
    items.push(item.reaction ? {...activity,...value} : {...activity,object:value});
  }
  return {'@context':CONTEXT,id:base+'?page='+start,type:'OrderedCollectionPage',partOf:base,orderedItems:items,
    ...(rows.length>20?{next:base+'?page='+(start+20)}:{})};
}
async function publicActivity(id) {
  if (!/^[a-f0-9]{32}(?:-old|-undo|-create)?$/.test(id)) throw error(404);
  await ensure();
  const row = (await C.sql('SELECT * FROM activitypub_activities WHERE id=?',[id]))[0];
  if (!row) throw error(404);
  const activity = parse(row);
  if (!['Delete','Undo'].includes(activity.type)) {
    const item = await Sources.read(C.sql,row.source,row.source_id);
    if (!item || (await actorFor(item.author)).id !== row.actor_id) throw error(410);
    if (['Create','Update'].includes(activity.type)) {
      const saved = await state(C.sql,row.source,row.source_id);
      if (!saved?.active || parse(saved).object.id !== activity.object.id) throw error(410);
    }
  }
  return activity;
}
async function inbox(actor, activity, remote) {
  if (typeof activity.id !== 'string' || activity.id.length > 2048 || new URL(Http.url(activity.id)).origin !== new URL(remote.id).origin) throw error(400,'Invalid activity ID.');
  if (!['Follow','Undo','Delete'].includes(activity.type)) return;
  await C.transaction(async q => {
    const receipt = await q('INSERT IGNORE INTO activitypub_receipts (receipt_hash) VALUES (?)',[hash(actor.id+'\n'+remote.id+'\n'+activity.id)]);
    if (!receipt.affectedRows) return;
    const remoteHash = hash(remote.id);
    if (activity.type === 'Follow') {
      if (!actor.author || activity.object !== actor.url) throw error(404);
      await q(`INSERT INTO activitypub_followers (actor_id,remote_hash,remote_actor,inbox,follow_id) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE inbox=VALUES(inbox),follow_id=VALUES(follow_id)`,[actor.id,remoteHash,remote.id,remote.inbox,activity.id]);
      const accept = {'@context':CONTEXT,id:absolute('/activitypub/activities/'+crypto.randomBytes(16).toString('hex')),type:'Accept',actor:actor.url,
        to:[remote.id],object:{id:activity.id,type:'Follow',actor:remote.id,object:actor.url}};
      await q('INSERT INTO activitypub_deliveries (actor_id,remote_hash,inbox,activity_json) VALUES (?,?,?,?)',[actor.id,remoteHash,remote.inbox,JSON.stringify(accept)]);
    } else if (activity.type === 'Undo') {
      const followId = typeof activity.object === 'string' ? activity.object : activity.object?.id;
      if (typeof activity.object !== 'string' && (activity.object?.type !== 'Follow' || activity.object.actor !== remote.id || activity.object.object !== actor.url)) throw error(400,'Invalid Undo.');
      if (typeof followId !== 'string') throw error(400,'Invalid Undo.');
      await q('DELETE FROM activitypub_followers WHERE actor_id=? AND remote_hash=? AND follow_id=?',[actor.id,remoteHash,followId]);
    } else if ((typeof activity.object === 'string' ? activity.object : activity.object?.id) === remote.id) {
      await q('DELETE FROM activitypub_followers WHERE actor_id=? AND remote_hash=?',[actor.id,remoteHash]);
    }
  });
}
module.exports = {CONTEXT,PUBLIC,hash,enabled,origin,absolute,actorUrl,ensure,actorFor,actorById,actorDocument,webfinger,
  state,parse,object,syncOne,publicObject,publicActivity,outbox,inbox};
