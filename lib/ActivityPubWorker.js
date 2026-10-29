'use strict';
const {promisify} = require('util');
const AP = require('./ActivityPub');
const Sources = require('./ActivityPubSources');
const Http = require('./ActivityPubHttp');

async function reconcile(q, limit = 100) {
  let changed = 0;
  for (const source of Sources.sourceNames) {
    const cursor = (await q('SELECT last_id FROM activitypub_cursors WHERE source=?',[source]))[0]?.last_id || 0;
    // Include saved IDs whose source rows were physically deleted, so unlikes
    // and undone reposts reliably emit Undo rather than vanishing silently.
    const rows = await q(`SELECT id FROM (SELECT id FROM ${Sources.tables[source]} WHERE id>?
      UNION SELECT source_id id FROM activitypub_objects WHERE source=? AND source_id>?) candidates ORDER BY id LIMIT ?`,[cursor,source,cursor,limit]);
    for (const row of rows) {
      await q('START TRANSACTION');
      try {
        if (await AP.syncOne(q,source,row.id)) changed++;
        await q('COMMIT');
      } catch (err) { await q('ROLLBACK'); throw err; }
    }
    await q('INSERT INTO activitypub_cursors (source,last_id) VALUES (?,?) ON DUPLICATE KEY UPDATE last_id=VALUES(last_id)',
      [source, rows.length === limit ? rows[rows.length-1].id : 0]);
  }
  return changed;
}
async function deliver(q, limit = 25) {
  const result = {sent:0,skipped:0,failed:0};
  for (let i=0;i<limit;i++) {
    // Preserve order per recipient; a delayed Create must not be overtaken by
    // an Update or Delete. A different recipient can continue independently.
    const job = (await q(`SELECT d.* FROM activitypub_deliveries d WHERE d.status='queued' AND d.available_at<=CURRENT_TIMESTAMP(3)
      AND NOT EXISTS(SELECT 1 FROM activitypub_deliveries earlier WHERE earlier.actor_id=d.actor_id
        AND earlier.remote_hash=d.remote_hash AND earlier.id<d.id AND earlier.status='queued') ORDER BY d.id LIMIT 1`))[0];
    if (!job) break;
    const activity = JSON.parse(job.activity_json);
    await q('UPDATE activitypub_deliveries SET attempts=attempts+1 WHERE id=?',[job.id]);
    try {
      let allowed = true;
      if (!['Delete','Undo'].includes(activity.type)) {
        const follower = (await q('SELECT inbox,follow_id FROM activitypub_followers WHERE actor_id=? AND remote_hash=?',[job.actor_id,job.remote_hash]))[0];
        allowed = !!follower;
        if (follower) job.inbox = follower.inbox;
        if (activity.type === 'Accept') allowed = allowed && follower.follow_id === activity.object.id;
        if (job.source) {
          const item = await Sources.read(q,job.source,job.source_id);
          const actor = item && await AP.actorFor(item.author,q);
          allowed = allowed && actor?.id === job.actor_id;
          // Preserve Create-before-Update ordering, but never resurrect an old
          // object after unpublication and republication created a new identity.
          if (allowed && ['Create','Update'].includes(activity.type)) {
            const saved = await AP.state(q,job.source,job.source_id);
            allowed = !!saved?.active && AP.parse(saved).object.id === activity.object.id;
          }
        }
      }
      if (!allowed) {
        await q("UPDATE activitypub_deliveries SET status='skipped' WHERE id=?",[job.id]); result.skipped++; continue;
      }
      const actor = (await q('SELECT * FROM activitypub_actors WHERE id=?',[job.actor_id]))[0];
      if (!actor) throw new Error('Missing federation signing identity.');
      const signingActor = {...actor,url:AP.actorUrl(actor.id)};
      if (activity.type === 'Update') {
        const prior = await q(`SELECT id FROM activitypub_deliveries WHERE actor_id=? AND remote_hash=? AND status='sent'
          AND JSON_UNQUOTE(JSON_EXTRACT(activity_json,'$.type'))='Create'
          AND JSON_UNQUOTE(JSON_EXTRACT(activity_json,'$.object.id'))=? LIMIT 1`,[job.actor_id,job.remote_hash,activity.object.id]);
        if (!prior.length) {
          // A new follower may first encounter an old post when it is edited.
          // Bootstrap it with Create, then send Update as well for peers that
          // already received the original before an ambiguous network failure.
          const create = {...activity,id:activity.id+'-create',type:'Create'};
          await q('INSERT IGNORE INTO activitypub_activities (id,actor_id,source,source_id,activity_json) VALUES (?,?,?,?,?)',
            [create.id.split('/').pop(),job.actor_id,job.source,job.source_id,JSON.stringify(create)]);
          await Http.request(job.inbox,{method:'POST',body:JSON.stringify(create),actor:signingActor});
        }
      }
      await Http.request(job.inbox,{method:'POST',body:job.activity_json,actor:signingActor});
      await q("UPDATE activitypub_deliveries SET status='sent' WHERE id=?",[job.id]); result.sent++;
    } catch (_) {
      const delay = Math.min(86400,60 * 2 ** Math.min(job.attempts,10));
      await q("UPDATE activitypub_deliveries SET status=IF(attempts>=10,'failed','queued'),available_at=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL ? SECOND) WHERE id=?",[delay,job.id]);
      result.failed++;
    }
  }
  return result;
}
async function run({scanLimit=100,deliveryLimit=25} = {}) {
  if (!AP.enabled()) return {disabled:true};
  AP.origin();
  await AP.ensure();
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const q = (sql, values=[]) => promisify(connection.query).call(connection,sql,values);
  let locked = false;
  try {
    locked = Number((await q("SELECT GET_LOCK('hadithdb.activitypub',0) acquired"))[0].acquired) === 1;
    if (!locked) return {busy:true};
    const changed = await reconcile(q,Math.max(1,Math.min(500,scanLimit)));
    return {changed,...await deliver(q,Math.max(1,Math.min(100,deliveryLimit)))};
  } finally {
    try { if (locked) await q("SELECT RELEASE_LOCK('hadithdb.activitypub')"); }
    finally { connection.release(); }
  }
}
module.exports = {run,reconcile,deliver};
