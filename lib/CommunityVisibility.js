'use strict';
const error = require('http-errors');
const sources = Object.freeze({post:'community_posts', like:'community_likes', hadith_like:'hadiths_likes', hadiths_comments_like:'hadiths_comments_votes', blog_comments_like:'blog_comments_votes', repost:'community_reposts'});
async function migrate(q) {
  await q(`CREATE TABLE IF NOT EXISTS community_hidden_activity (
    source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (source,source_id)
  ) ENGINE=InnoDB`);
}
// Apply before pagination. Owners retain their activity on their own wall.
function hiddenPredicate(source, id) {
  return `EXISTS (SELECT 1 FROM community_hidden_activity hv WHERE hv.source=${source} AND hv.source_id=${id})`;
}
function predicate(source, id, actor, uid, params) {
  params.push(uid || '');
  return `(${actor}=? OR NOT EXISTS (SELECT 1 FROM community_hidden_activity hv WHERE hv.source=${source} AND hv.source_id=${id}))`;
}
async function set(user, source, rawId, hidden) {
  const C = require('./Community');
  if (!user?.uid) throw error(401, 'Please sign in.');
  if (!sources[source] || typeof hidden !== 'boolean') throw error(400, 'Invalid visibility change.');
  const id = C.id(rawId);
  await C.transaction(async q => {
    const row = (await q(`SELECT * FROM ${sources[source]} WHERE id=? FOR UPDATE`, [id]))[0];
    if (!row || (source === 'post' ? row.author_uid : row.user_uid) !== user.uid) throw error(404, 'Activity not found.');
    if (source === 'post') {
      if (!['published','private'].includes(row.status)) throw error(409, 'Only published or privately hidden posts can change visibility.');
      await q('UPDATE community_posts SET status=?,version=version+1 WHERE id=?', [hidden ? 'private' : 'published', id]);
      if (hidden) await q("UPDATE community_email_outbox SET status='cancelled' WHERE post_id=? AND status IN ('queued','sending')", [id]);
      await require('./CommunityDrive').enqueue(q, user.uid, id);
    } else if (hidden) await q('INSERT IGNORE INTO community_hidden_activity (source,source_id) VALUES (?,?)', [source,id]);
    else await q('DELETE FROM community_hidden_activity WHERE source=? AND source_id=?', [source,id]);
  });
  await require('./BlogPageCache').invalidate();
  return {hidden};
}
async function decorate(q, items, user) {
  if (!user?.uid || !items.length) return;
  const author = (await q('SELECT handle FROM community_authors WHERE uid=?', [user.uid]))[0];
  if (!author) return;
  const own = items.filter(item => sources[item.activity] && (item.repostedBy || item.author)?.handle === author.handle);
  if (!own.length) return;
  const rows = await q('SELECT source,source_id FROM community_hidden_activity WHERE source_id IN (?)', [own.map(item=>item.id)]);
  const hidden = new Set(rows.map(row=>row.source+':'+row.source_id));
  for (const item of own) {
    item.canHide = item.activity !== 'post' || ['published','private'].includes(item.status);
    item.hiddenFromOthers = item.status === 'private' || hidden.has(item.activity+':'+item.id);
  }
}
module.exports = {sources,migrate,predicate,hiddenPredicate,set,decorate};
