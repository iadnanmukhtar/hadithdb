'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const createError = require('http-errors');
const { load } = require('cheerio');
const Notebook = require('./NotebookDrive');
const { key } = require('./UserNotebook');
const sql = (statement, values = []) => promisify(global.dbPool.query).call(global.dbPool, statement, values);
let ready;
function ensureTable() {
  if (!ready) ready = (async () => {
    await sql(`CREATE TABLE IF NOT EXISTS user_notebook_shares (
    user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    source_key VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    drive_file_url VARCHAR(512) NOT NULL,
    PRIMARY KEY (user_uid, source_key), UNIQUE KEY (token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await sql(`CREATE TABLE IF NOT EXISTS user_notebook_authors (
      user_uid VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      photo VARCHAR(2048) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(err => { ready = null; throw err; });
  return ready;
}
function publicAuthor(user) {
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  let photo = null;
  try {
    const url = new URL(user?.photo);
    if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048) photo = url.href;
  } catch (_) { /* A missing profile image uses the author's initial. */ }
  // Authentication may use email as a fallback name; do not publish it.
  return { name: name && name !== user?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) ? name.slice(0, 255) : 'Author', photo };
}
async function rememberAuthor(user) {
  if (!user?.uid) return;
  const author = publicAuthor(user);
  await ensureTable();
  await sql(`INSERT INTO user_notebook_authors (user_uid, name, photo) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE name=VALUES(name), photo=VALUES(photo)`, [user.uid, author.name, author.photo]);
}
async function status(uid, source) {
  source = key(source);
  await ensureTable();
  const rows = await sql('SELECT token, drive_file_url FROM user_notebook_shares WHERE user_uid=? AND source_key=?', [uid, source]);
  if (!rows.length) return { token: null };
  let note;
  try { note = await Notebook.get(uid, source); }
  catch (_) { return { token: rows[0].token }; } // Keep revocation available if Drive is offline.
  return { token: note?.driveFileUrl === rows[0].drive_file_url ? rows[0].token : null };
}
async function enable(uid, source) {
  source = key(source);
  const note = await Notebook.get(uid, source);
  if (!note?.version || !note.driveFileUrl) throw createError(404, 'Save this note before sharing it.');
  await ensureTable();
  // A replacement Drive file gets a new token; a revoked token is never reused.
  await sql(`INSERT INTO user_notebook_shares (user_uid, source_key, token, drive_file_url) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE token=IF(drive_file_url=VALUES(drive_file_url), token, VALUES(token)), drive_file_url=VALUES(drive_file_url)`,
  [uid, source, crypto.randomBytes(32).toString('hex'), note.driveFileUrl]);
  const rows = await sql('SELECT token, drive_file_url FROM user_notebook_shares WHERE user_uid=? AND source_key=?', [uid, source]);
  return { token: rows[0]?.token || null };
}
async function revoke(uid, source) {
  source = key(source);
  await ensureTable();
  await sql('DELETE FROM user_notebook_shares WHERE user_uid=? AND source_key=?', [uid, source]);
  return { token: null };
}
function publicContent(markdown) {
  const $ = load(Notebook.render(markdown), null, false);
  $('[data-notebook-reference], .notebook-expand-reference').remove();
  // Private wiki targets are never resolved for public readers.
  $('[data-notebook-wiki]').each((_, link) => { $(link).replaceWith($(link).contents()); });
  const outline = [];
  $('h1, h2, h3, h4, h5, h6').each((_, heading) => {
    const label = $(heading).text().trim();
    if (!label) return;
    const id = `shared-note-heading-${outline.length + 1}`;
    $(heading).attr({ id, tabindex: '-1' });
    const parts = label.split(/([\p{Script_Extensions=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script_Extensions=Arabic}\u200c\u200d]+)*)/gu)
      .filter(Boolean).map(text => ({ text, arabic: /\p{Script_Extensions=Arabic}/u.test(text) }));
    outline.push({ id, level: Number(heading.tagName.slice(1)), parts });
  });
  const baseLevel = Math.min(...outline.map(heading => heading.level));
  return { html: $.html(), outline: outline.map(heading => ({ ...heading, depth: heading.level - baseLevel })) };
}
async function read(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw createError(404, 'This shared note is unavailable.');
  await ensureTable();
  const rows = await sql('SELECT user_uid, source_key, drive_file_url FROM user_notebook_shares WHERE token=?', [token]);
  const share = rows[0];
  if (!share) throw createError(404, 'This shared note is unavailable.');
  let note;
  try { note = await Notebook.get(share.user_uid, share.source_key); }
  catch (err) {
    if ([401, 403, 404, 428].includes(err.status)) throw createError(404, 'This shared note is unavailable.');
    throw err;
  }
  if (!note || note.driveFileUrl !== share.drive_file_url) throw createError(404, 'This shared note is unavailable.');
  // Recheck after the Drive read so a revocation during that request wins.
  const active = await sql('SELECT token FROM user_notebook_shares WHERE token=?', [token]);
  if (!active.length) throw createError(404, 'This shared note is unavailable.');
  const authors = await sql('SELECT name, photo FROM user_notebook_authors WHERE user_uid=?', [share.user_uid]);
  return { title: note.title || 'Shared note', author: publicAuthor(authors[0]), ...publicContent(note.markdown) };
}
module.exports = { status, enable, revoke, read, rememberAuthor };
