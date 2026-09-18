'use strict';

const mysql = require('mysql');
const MarkdownIt = require('markdown-it');
const createError = require('http-errors');
const References = require('./NotebookReferences');
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });
References.install(markdown);
const arabicText = /[\p{Script_Extensions=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script_Extensions=Arabic}\u200c\u200d]+)*/gu;
function renderArabicText(text) {
  return markdown.utils.escapeHtml(text).replace(arabicText, '<span class="notebook-arabic">$&</span>');
}
markdown.renderer.rules.text = (tokens, index) => renderArabicText(tokens[index].content);
markdown.renderer.rules.code_inline = (tokens, index) => {
  const text = tokens[index].content;
  const hasArabic = /\p{Script_Extensions=Arabic}/u.test(text);
  return hasArabic
    ? `<code dir="auto" class="notebook-arabic">${renderArabicText(text)}</code>`
    : `<code>${markdown.utils.escapeHtml(text)}</code>`;
};
// Direction is determined independently for each block, including mixed-language notes.
markdown.core.ruler.push('notebook_direction', state => {
  state.tokens.forEach(token => {
    if (token.nesting === 1 && /^(paragraph|heading|blockquote|list_item|th|td)_open$/.test(token.type))
      token.attrSet('dir', 'auto');
  });
});
let ready;
function ensureTable() {
  if (!ready) ready = global.query(`CREATE TABLE IF NOT EXISTS user_notebook (
    user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    source_key VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    source_title VARCHAR(500) NOT NULL,
    source_url VARCHAR(1000) NOT NULL,
    markdown MEDIUMTEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_uid, source_key), KEY notebook_updated (user_uid, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(err => { ready = null; throw err; });
  return ready;
}
function key(value) {
  if (typeof value !== 'string' || !/^(item:\d+|heading:\d+|intro:\d+|sharh:\d+|heading-sharh:\d+|tafsir:[A-Za-z0-9_-]+:\d+:\d+|tafsir-heading:[A-Za-z0-9_-]+:[\d.]+)$/.test(value) || value.length > 191)
    throw createError(400, 'Invalid note source.');
  return value;
}
function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\\\x00-\x20]/.test(value)) throw createError(400, 'Invalid source URL.');
  if (/^\/(?!\/)/.test(value)) return value;
  const allowed = Object.values((global.settings || {}).site || {}).filter(v => typeof v === 'string' && /^https?:\/\//.test(v)).map(v => new URL(v).origin);
  try { const url = new URL(value); if (allowed.includes(url.origin) && !url.username && !url.password) return value; } catch (_) { /* invalid URL */ }
  throw createError(400, 'Invalid source URL.');
}
function present(row) { return { ...row, html: markdown.render(row.markdown) }; }
async function get(uid, source) {
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT source_key, source_title, source_url, markdown, version, updated_at FROM user_notebook WHERE user_uid=? AND source_key=?', [uid, key(source)]));
  return rows[0] ? present(rows[0]) : null;
}
async function status(uid, sources) {
  if (!Array.isArray(sources) || sources.length > 200) throw createError(400, 'Invalid note sources.');
  const keys = [...new Set(sources.map(key))];
  if (!keys.length) return [];
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT source_key FROM user_notebook WHERE user_uid=? AND source_key IN (?)', [uid, keys]));
  return rows.map(row => row.source_key);
}
async function list(uid, offset = 0) {
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT source_key, source_title, source_url, markdown, version, updated_at FROM user_notebook WHERE user_uid=? ORDER BY updated_at DESC, source_key LIMIT 13 OFFSET ?', [uid, offset]));
  return { notes: rows.slice(0, 12).map(present), hasMore: rows.length > 12 };
}
async function exportZip(uid) {
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT source_key, source_title, markdown FROM user_notebook WHERE user_uid=? ORDER BY source_key', [uid]));
  const zip = new (require('adm-zip'))();
  for (const note of rows) {
    const title = note.source_title.replace(/[^\p{L}\p{N} _-]/gu, '-').slice(0, 80).trim() || 'Note';
    const identity = key(note.source_key).replace(/:/g, '-');
    zip.addFile(`${title} (${identity}).md`, Buffer.from(note.markdown, 'utf8'));
  }
  return zip.toBufferPromise();
}
async function save(uid, body) {
  const source = key(body.source_key);
  if (typeof body.markdown !== 'string' || !body.markdown.trim()) throw createError(400, 'Write a note before saving.');
  if (Buffer.byteLength(body.markdown, 'utf8') > 65535) throw createError(413, 'Notes can contain up to 64 KB of Markdown.');
  if (typeof body.source_title !== 'string' || !body.source_title.trim() || body.source_title.length > 500) throw createError(400, 'Invalid source title.');
  const url = sourceUrl(body.source_url);
  if (!Number.isInteger(body.version) || body.version < 0) throw createError(400, 'Invalid note version.');
  await ensureTable();
  if (body.version === 0) {
    try { await global.query(mysql.format('INSERT INTO user_notebook (user_uid, source_key, source_title, source_url, markdown) VALUES (?, ?, ?, ?, ?)', [uid, source, body.source_title, url, body.markdown])); }
    catch (err) { if (err.code === 'ER_DUP_ENTRY') throw createError(409, 'This note changed elsewhere. Reopen it before saving.'); throw err; }
  } else {
    const result = await global.query(mysql.format('UPDATE user_notebook SET markdown=?, source_title=?, source_url=?, version=version+1, updated_at=CURRENT_TIMESTAMP(3) WHERE user_uid=? AND source_key=? AND version=?', [body.markdown, body.source_title, url, uid, source, body.version]));
    if (!result.affectedRows) throw createError(409, 'This note changed elsewhere. Reopen it before saving.');
  }
  return get(uid, source);
}
async function remove(uid, source, version) {
  if (!Number.isInteger(version) || version < 1) throw createError(400, 'Invalid note version.');
  await ensureTable();
  const result = await global.query(mysql.format('DELETE FROM user_notebook WHERE user_uid=? AND source_key=? AND version=?', [uid, key(source), version]));
  if (!result.affectedRows) throw createError(409, 'This note changed elsewhere. Reopen it before deleting.');
}
async function expand(uid, body) {
  if (typeof body.markdown !== 'string' || Buffer.byteLength(body.markdown, 'utf8') > 65535) throw createError(400, 'Invalid Markdown.');
  const ref = References.reference(body.reference);
  const env = {};
  markdown.render(body.markdown, env);
  if (!env.notebookReferences.has(ref)) throw createError(400, 'This reference is not present in the note.');
  if (env.notebookExpandedReferences.has(ref)) throw createError(409, 'This reference is already expanded. Reopen the note to see it.');
  const snapshot = await References.snapshot(ref);
  return save(uid, { ...body, markdown: `${body.markdown.trimEnd()}\n\n${snapshot}\n` });
}
module.exports = { exportZip, status, expand, get, list, save, remove, key, sourceUrl, render: text => markdown.render(text), ensureTable };
