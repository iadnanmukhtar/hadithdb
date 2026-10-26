'use strict';
const createError = require('http-errors');
const { createHash } = require('crypto');
const Community = () => require('./Community');
const { sourceUrl } = require('./CommunityReflections');

async function migrate(q) {
  // Old dislikes have no trustworthy timestamp; only new reactions become alerts.
  const columns = await q("SHOW COLUMNS FROM community_dislikes LIKE 'created_at'");
  if (!columns.length) await q('ALTER TABLE community_dislikes ADD COLUMN created_at DATETIME(3) NULL');
}

const identity = column => `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_bin`;
function query() {
  const sources = ['hadiths_comments', 'blog_comments'];
  const referenceFields = source => source === 'blog_comments'
    ? "NULL AS ref_num, NULL AS hadith_id, NULL AS ref_type, c.post_slug"
    : 'c.ref_num, c.hadithId AS hadith_id, c.type AS ref_type, NULL AS post_slug';
  const targets = [
    `SELECT 'post' AS source, p.id, p.author_uid AS owner_uid, p.public_title AS title,
      p.id AS post_id, a.handle AS post_handle, NULL AS ref_num, NULL AS hadith_id, NULL AS ref_type, NULL AS post_slug
      FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid WHERE p.status='published'`,
    `SELECT 'comment', c.id, c.author_uid, p.public_title, p.id, a.handle, NULL, NULL, NULL, NULL
      FROM community_comments c JOIN community_posts p ON p.id=c.post_id JOIN community_authors a ON a.uid=p.author_uid
      WHERE p.status='published' AND c.deleted=0`,
    ...sources.map(source => `SELECT '${source}', c.id, ${identity('c.user_uid')}, 'Reflection', NULL, NULL, ${referenceFields(source)}
      FROM ${source} c WHERE COALESCE(c.deleted,0)=0 AND c.text IS NOT NULL AND TRIM(c.text)<>''`)
  ];
  const events = [
    `SELECT CONCAT('post:',p.id) AS event_key, 'post' AS kind, p.author_uid AS actor_uid, NULL AS actor_name,
      p.published_at AS event_at, 'post' AS source, p.id AS target_id, NULL AS recipient_uid, NULL AS other_recipient_uid
      FROM community_posts p WHERE p.status='published'`,
    `SELECT CONCAT('comment:',c.id), 'reply', c.author_uid, NULL, c.created_at, 'comment', c.id,
      p.author_uid, parent.author_uid FROM community_comments c JOIN community_posts p ON p.id=c.post_id
      LEFT JOIN community_comments parent ON parent.id=c.parent_id AND parent.post_id=c.post_id AND parent.deleted=0
      WHERE c.deleted=0 AND p.status='published'`,
    ...sources.map(source => `SELECT CONCAT('${source}:',c.id), 'reflection', ${identity('c.user_uid')}, c.user_name, c.createdAt,
      '${source}', c.id, ${identity('parent.user_uid')}, NULL
      FROM ${source} c LEFT JOIN ${source} parent ON parent.id=c.parentId AND COALESCE(parent.deleted,0)=0
      WHERE COALESCE(c.deleted,0)=0`),
    ...[['community_likes', 'like'], ['community_dislikes', 'dislike'], ['community_reposts', 'repost']].map(([table, kind]) =>
      `SELECT CONCAT('${kind}:',r.source,':',r.target_id,':',r.user_uid), '${kind}', r.user_uid, NULL, r.created_at,
        r.source, r.target_id, NULL, NULL FROM ${table} r WHERE r.created_at IS NOT NULL`)
  ];
  return `WITH targets AS (${targets.join('\nUNION ALL\n')}), events AS (${events.join('\nUNION ALL\n')}),
    activity AS (
      SELECT e.*, t.title, t.post_id, t.post_handle, t.ref_num, t.hadith_id, t.ref_type, t.post_slug,
        CASE WHEN e.kind IN ('like','dislike','repost') THEN t.owner_uid ELSE e.recipient_uid END AS recipient
      FROM events e JOIN targets t ON t.source=e.source AND t.id=e.target_id
      UNION ALL
      SELECT CONCAT('hadith_like:',l.id), 'like', ${identity('l.user_uid')}, l.user_name, l.createdAt,
        'hadith', l.hadithId, NULL, NULL, 'Source passage', NULL, NULL, l.ref_num, l.hadithId, l.type, NULL, NULL
      FROM hadiths_likes l
    )
    SELECT activity.*, a.handle AS actor_handle, COALESCE(a.name, activity.actor_name, 'Community member') AS name
    FROM activity LEFT JOIN community_authors a ON a.uid=activity.actor_uid
    WHERE activity.actor_uid<>? AND activity.event_at>? AND activity.event_at<=?
      AND (activity.recipient=? OR activity.other_recipient_uid=? OR EXISTS (
        SELECT 1 FROM community_follows f WHERE f.follower_uid=? AND f.author_uid=activity.actor_uid
          AND f.created_at<=activity.event_at
      ))
    ORDER BY activity.event_at DESC, activity.event_key DESC LIMIT 101`;
}

function item(row) {
  let url;
  if (row.post_id) url = `/community/@${row.post_handle}/${row.post_id}${row.source === 'comment' ? '#comment-' + row.target_id : ''}`;
  else url = sourceUrl({ ref_num: row.ref_num, hadithId: row.hadith_id, type: row.ref_type, post_slug: row.post_slug }, row.source === 'blog_comments' ? 'blog_comments' : 'hadiths_comments');
  const rawName = String(row.name || '').trim();
  const name = rawName && !/\S+@\S+/.test(rawName) ? rawName.slice(0, 120) : 'Community member';
  return { id: createHash('sha256').update(row.event_key).digest('hex'), kind: row.kind, author: { name, handle: row.actor_handle || null },
    title: row.title || 'Post', url, createdAt: row.event_at };
}

async function unread(user) {
  if (!user?.uid) throw createError(401, 'Please sign in.');
  await Community().ensure();
  const q = Community().sql;
  // Capture the upper bound before reading: later arrivals must remain unread.
  const [clock] = await q('SELECT CURRENT_TIMESTAMP(3) AS through_at');
  const [read] = await q('SELECT seen_at FROM community_alert_reads WHERE user_uid=?', [user.uid]);
  const through = clock.through_at;
  const rows = await q(query(), [user.uid, read?.seen_at || new Date(0), through, user.uid, user.uid, user.uid]);
  const items = rows.map(item);
  return { count: rows.length, hasMore: rows.length > 100, through: new Date(through).toISOString(), items };
}

async function markRead(user, through) {
  if (!user?.uid) throw createError(401, 'Please sign in.');
  if (typeof through !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(through) || !Number.isFinite(Date.parse(through)))
    throw createError(400, 'Invalid alert read time.');
  await Community().ensure();
  await Community().sql(`INSERT INTO community_alert_reads (user_uid,seen_at) VALUES (?,LEAST(?,CURRENT_TIMESTAMP(3)))
    ON DUPLICATE KEY UPDATE seen_at=GREATEST(seen_at,VALUES(seen_at))`, [user.uid, new Date(through)]);
  return { read: true };
}
module.exports = { migrate, unread, markRead };
