'use strict';
const crypto = require('crypto');
const createError = require('http-errors');
const Community = require('./Community');
const categories = {likes:'Likes', reflections:'Reflections and comments', replies:'Replies', reactions:'Reactions', articles:'Articles from authors you follow'};
const keys = ['enabled', ...Object.keys(categories)];
let ready;
function ensure() {
  if (!ready) ready = Community.sql(require('fs').readFileSync(require('path').join(__dirname, '../data/migrations/email-preferences.sql'), 'utf8')).catch(err => {ready=null;throw err;});
  return ready;
}
function emailHash(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw createError(400, 'An account email is needed to manage notifications.');
  return crypto.createHash('sha256').update(address).digest('hex');
}
function preferences(row) { return Object.fromEntries(keys.map(key => [key, Number(row[key]) === 1])); }
async function forEmail(email) {
  const hash = emailHash(email);
  await ensure();
  await Community.sql('INSERT IGNORE INTO email_preferences (email_hash,unsubscribe_token) VALUES (?,?)', [hash, crypto.randomBytes(32).toString('hex')]);
  const [row] = await Community.sql('SELECT * FROM email_preferences WHERE email_hash=?', [hash]);
  return row;
}
async function get(user) { return preferences(await forEmail(user.email)); }
async function save(user, input) {
  if (!input || keys.some(key => typeof input[key] !== 'boolean') || Object.keys(input).some(key => !keys.includes(key))) throw createError(400, 'Choose your email preferences.');
  await forEmail(user.email);
  await Community.sql(`UPDATE email_preferences SET ${keys.map(key => key+'=?').join(',')} WHERE email_hash=?`, [...keys.map(key => input[key] ? 1 : 0), emailHash(user.email)]);
  return get(user);
}
async function tokenRow(token, category) {
  if (!/^[a-f0-9]{64}$/.test(token) || !Object.hasOwn(categories,category)) throw createError(400, 'Invalid unsubscribe link.');
  await ensure();
  const [row] = await Community.sql('SELECT * FROM email_preferences WHERE unsubscribe_token=?', [token]);
  if (!row) throw createError(404, 'This unsubscribe link is no longer available.');
  return row;
}
async function unsubscribe(token, category) {
  await tokenRow(token, category);
  // Category is validated against the fixed allowlist above.
  await Community.sql(`UPDATE email_preferences SET ${category}=0 WHERE unsubscribe_token=?`, [token]);
}
module.exports = {categories, keys, ensure, forEmail, get, save, tokenRow, unsubscribe};
