'use strict';
const crypto = require('crypto');
const error = require('http-errors');
function parse(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.length > 1500000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw error(400, 'Choose a photo and apply its crop first.');
  const data = Buffer.from(value.slice(22), 'base64');
  if (require('./CommunityMedia').imageType(data) !== 'image/png' || data.readUInt32BE(16) !== 512 || data.readUInt32BE(20) !== 512) throw error(400, 'Apply a square profile photo crop first.');
  return {data, hash: crypto.createHash('sha256').update(data).digest('hex')};
}
async function save(q, uid, photo) {
  if (photo === undefined) return;
  if (photo === null) { await q('DELETE FROM community_profile_photos WHERE user_uid=?', [uid]); return; }
  await q(`INSERT INTO community_profile_photos (user_uid,hash,data) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE hash=VALUES(hash),data=VALUES(data)`, [uid, photo.hash, photo.data]);
}
function url(handle, hash) { return `/community/profile-photo/${encodeURIComponent(handle)}/${hash}`; }
async function decorate(authors) {
  if (!authors.length) return;
  const C = require('./Community');
  await C.ensure();
  const rows = await C.sql(`SELECT a.handle,p.hash FROM community_profile_photos p JOIN community_authors a ON a.uid=p.user_uid WHERE a.handle IN (?)`, [authors.map(a=>a.handle).filter(Boolean)]);
  const byHandle = new Map(rows.map(row=>[row.handle,row.hash]));
  for (const author of authors) {
    const hash = byHandle.get(author.handle);
    if (hash) { author.accountPhoto = author.photo; author.photo = url(author.handle, hash); author.customPhoto = true; }
  }
}
async function image(handle, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw error(404, 'Photo not found.');
  const C = require('./Community'); await C.ensure();
  const [row] = await C.sql('SELECT p.data FROM community_profile_photos p JOIN community_authors a ON a.uid=p.user_uid WHERE a.handle=? AND p.hash=?', [handle,hash]);
  if (!row) throw error(404, 'Photo not found.');
  return row.data;
}
module.exports = {parse,save,decorate,image,url};
