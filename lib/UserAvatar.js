'use strict';
const crypto = require('crypto');
const {promisify} = require('util');
const sql = (statement, values = []) => promisify(global.dbPool.query).call(global.dbPool, statement, values);
let ready;
function photoUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048 ? url.href : null; }
  catch (_) { return null; }
}
function gravatar(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const hash = normalized ? crypto.createHash('md5').update(normalized).digest('hex') : '';
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=96`;
}
async function ensure() {
  if (!ready) ready = sql(`CREATE TABLE IF NOT EXISTS user_profile_photos (
    user_uid VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
    photo VARCHAR(2048) NULL, gravatar VARCHAR(255) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(err => { ready=null; throw err; });
  return ready;
}
async function remember(user) {
  await ensure();
  const photo = photoUrl(user.photo || user.photoURL);
  const fallback = gravatar(user.email);
  await sql(`INSERT INTO user_profile_photos (user_uid,photo,gravatar) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE photo=VALUES(photo),gravatar=VALUES(gravatar),updated_at=CURRENT_TIMESTAMP(3)`,[user.uid,photo,fallback]);
  return {photo:photo || fallback,avatarFallback:fallback};
}
async function seedHistorical(q, row, uid = row.user_uid) {
  if (!uid || uid.length > 128 || (!row.user_email && !photoUrl(row.user_photo))) return;
  await ensure();
  // Historical presentation only: never overwrite a photo refreshed at sign-in.
  await q('INSERT IGNORE INTO user_profile_photos (user_uid,photo,gravatar) VALUES (?,?,?)',
    [uid,photoUrl(row.user_photo),gravatar(row.user_email)]);
}
async function decorateRows(rows) {
  if (!rows.length) return;
  await ensure();
  const uids=[...new Set(rows.map(row=>row.user_uid).filter(Boolean))];
  const profiles = uids.length ? await sql('SELECT * FROM user_profile_photos WHERE user_uid IN (?)',[uids]) : [];
  const byUid=new Map(profiles.map(row=>[row.user_uid,row]));
  for(const row of rows) {
    const profile=byUid.get(row.user_uid);
    row.avatarFallback=profile?.gravatar || gravatar(row.user_email);
    row.avatarPhoto=profile ? profile.photo || row.avatarFallback : photoUrl(row.user_photo) || row.avatarFallback;
  }
}
async function decorateAuthors(authors) {
  if (!authors.length) return;
  await ensure();
  const handles=[...new Set(authors.map(author=>author.handle).filter(Boolean))];
  const rows=handles.length ? await sql(`SELECT a.handle,a.email,p.user_uid,p.photo,p.gravatar FROM community_authors a
    LEFT JOIN user_profile_photos p ON p.user_uid=a.uid WHERE a.handle IN (?)`,[handles]) : [];
  const byHandle=new Map(rows.map(row=>[row.handle,row]));
  for(const author of authors) {
    const row=byHandle.get(author.handle);
    author.avatarFallback=row?.gravatar || (row?.email ? gravatar(row.email) : author.avatarFallback) || gravatar();
    author.photo=row?.user_uid ? row.photo || author.avatarFallback : photoUrl(author.photo) || author.avatarFallback;
  }
  await require('./CommunityProfilePhoto').decorate(authors);
}
module.exports={ensure,remember,seedHistorical,decorateRows,decorateAuthors,photoUrl,gravatar};
