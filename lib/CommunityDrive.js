'use strict';
const { promisify } = require('util');
const crypto = require('crypto');
const yaml = require('js-yaml');
const Drive = require('./NotebookDrive');
const sql = (s, v = []) => promisify(global.dbPool.query).call(global.dbPool, s, v);
let ready, timer, running = false;
async function ensure() {
  if (!ready) ready = (async () => {
    await Drive.ensureTable();
    await sql(`CREATE TABLE IF NOT EXISTS community_drive_settings (
      user_uid VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
      enabled TINYINT NOT NULL DEFAULT 0,
      folder_id VARCHAR(128) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await sql(`CREATE TABLE IF NOT EXISTS community_drive_files (
      post_id BIGINT PRIMARY KEY,
      user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      file_id VARCHAR(128) NULL,
      generation BIGINT NOT NULL DEFAULT 1,
      pending TINYINT NOT NULL DEFAULT 1,
      available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      synced_at DATETIME(3) NULL,
      KEY pending_work(pending,available_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(err => { ready = null; throw err; });
  return ready;
}
// Called in the same transaction as the primary write. No Drive calls here.
async function enqueue(q, uid, postId) {
  await q(`INSERT IGNORE INTO community_drive_files (post_id,user_uid)
    SELECT ?, s.user_uid FROM community_drive_settings s
    WHERE s.user_uid=? AND s.enabled=1`, [postId, uid]);
  // Keep previously mirrored items current even while disconnected/disabled.
  // Delivery stays paused until the user enables the connection again.
  await q(`UPDATE community_drive_files SET generation=generation+1,pending=1,
    available_at=CURRENT_TIMESTAMP(3) WHERE post_id=? AND user_uid=?`, [postId, uid]);
}
async function status(uid) {
  await ensure();
  const settings = (await sql('SELECT enabled FROM community_drive_settings WHERE user_uid=?', [uid]))[0];
  const stats = (await sql('SELECT SUM(pending) AS pending,MAX(synced_at) AS synced_at FROM community_drive_files WHERE user_uid=?', [uid]))[0];
  return { enabled: !!settings?.enabled, pending: Number(stats?.pending || 0), syncedAt: stats?.synced_at || null };
}
async function configure(uid, enabled) {
  if (typeof enabled !== 'boolean') throw require('http-errors')(400, 'Choose whether to copy posts and articles to Google Drive.');
  await ensure();
  if (enabled && !(await Drive.connectionStatus(uid)).connected) throw require('http-errors')(428, 'Connect Google Drive first.');
  await sql('INSERT INTO community_drive_settings (user_uid,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)', [uid, enabled ? 1 : 0]);
  // Deliberately no scan/backfill of existing posts.
  return status(uid);
}
function encode(post) {
  return '---\n' + yaml.safeDump({ id: String(post.guid || post.id), kind: post.kind === 'article' ? 'article' : 'post',
    title: post.title || '', subtitle: post.subtitle || '', tags: post.tags || '', status: post.status,
    cover: post.cover_url || null, created: post.created_at || null, updated: post.updated_at || null,
    published: post.published_at || null }, { lineWidth: -1 }) + '---\n\n' + post.markdown;
}
async function folder(store, uid) {
  let folderId = (await sql('SELECT folder_id FROM community_drive_settings WHERE user_uid=?', [uid]))[0]?.folder_id;
  if (!folderId) {
    folderId = await store.generateId();
    await sql('UPDATE community_drive_settings SET folder_id=? WHERE user_uid=?', [folderId, uid]);
  }
  try {
    const file = (await store.request(`drive/v3/files/${folderId}`, { params: { fields: 'id,trashed' } })).data;
    if (file.trashed) throw new Error('Restore the posts and articles folder in Google Drive.');
  } catch (err) {
    if (err.status !== 404) throw err;
    await store.request('drive/v3/files', { method: 'POST', data: { id: folderId,
      name: 'Hadith Unlocked Posts and Articles', mimeType: 'application/vnd.google-apps.folder' } });
  }
  return folderId;
}
async function sync(store, job, post, reserve, folderId) {
  if (post.status === 'deleted') {
    if (job.file_id) {
      try { await store.request(`drive/v3/files/${job.file_id}`, { method: 'PATCH', data: { trashed: true } }); }
      catch (err) { if (err.status !== 404) throw err; }
    }
    return;
  }
  if (!job.file_id) { job.file_id = await store.generateId(); await reserve(job.file_id); }
  let exists = true;
  try { await store.request(`drive/v3/files/${job.file_id}`, { params: { fields: 'id' } }); }
  catch (err) { if (err.status !== 404) throw err; exists = false; }
  // A separate folder keeps these exports out of notebook discovery.
  const metadata = { name: `${(post.title || (post.kind === 'article' ? 'Article' : 'Post')).replace(/[^\p{L}\p{N} _-]/gu, '-').slice(0, 80)} (${post.guid || post.id}).md`,
    mimeType: 'text/markdown', appProperties: { application: 'hadithunlocked-community', post_id: String(post.id) },
    ...(exists ? { trashed: false } : { id: job.file_id, ...(folderId ? { parents: [folderId] } : {}) }) };
  const boundary = 'community_' + crypto.randomBytes(16).toString('hex');
  const data = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${encode(post)}\r\n--${boundary}--`;
  await store.request(`upload/drive/v3/files${exists ? '/' + job.file_id : ''}`, {
    method: exists ? 'PATCH' : 'POST', params: { uploadType: 'multipart' }, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, data
  });
}
async function deliverBatch() {
  await ensure();
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const q = promisify(connection.query).bind(connection);
  let acquired = false;
  try {
    // A connection-owned lock prevents stale workers overwriting newer copies.
    acquired = (await q("SELECT GET_LOCK('community-drive-worker',0) AS acquired"))[0].acquired === 1;
    if (!acquired) return;
    const jobs = await sql(`SELECT f.* FROM community_drive_files f
      JOIN community_drive_settings s ON s.user_uid=f.user_uid AND s.enabled=1
      JOIN user_notebook_drive d ON d.user_uid=f.user_uid AND d.token_cipher IS NOT NULL
      WHERE f.pending=1 AND f.available_at<=CURRENT_TIMESTAMP(3) ORDER BY f.available_at LIMIT 10`);
    for (const job of jobs) {
      try {
        const post = (await sql('SELECT * FROM community_posts WHERE id=? AND author_uid=?', [job.post_id, job.user_uid]))[0];
        if (!post) throw new Error('Missing primary post');
        const store = await Drive.shadowClient(job.user_uid);
        await sync(store, job, post, fileId => sql('UPDATE community_drive_files SET file_id=? WHERE post_id=?', [fileId, job.post_id]), post.status === 'deleted' ? null : await folder(store, job.user_uid));
        await sql('UPDATE community_drive_files SET pending=0,synced_at=CURRENT_TIMESTAMP(3) WHERE post_id=? AND generation=?', [job.post_id, job.generation]);
      } catch (_) {
        await sql('UPDATE community_drive_files SET available_at=DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE post_id=? AND generation=?', [job.post_id, job.generation]);
      }
    }
  } finally {
    try { if (acquired) await q("SELECT RELEASE_LOCK('community-drive-worker')"); connection.release(); }
    catch (_) { connection.destroy(); }
  }
}
function start() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await deliverBatch(); }
    catch (_) { require('./Debug')('hadithdb:CommunityDrive')('Drive shadow sync pending; will retry.'); }
    finally { running = false; }
  };
  timer = setInterval(tick, 15000); timer.unref();
  void tick();
}
module.exports = { ensure, enqueue, status, configure, encode, sync, deliverBatch, start };
