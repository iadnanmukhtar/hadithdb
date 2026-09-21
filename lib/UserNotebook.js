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
function normalizeSearch(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[ـʿʾ]/g, '').toLowerCase();
}
function hashtags(text) {
  const tags = new Map();
  for (const block of markdown.parse(text, {})) {
    for (const token of block.children || []) {
      if (token.type !== 'text') continue;
      for (const match of token.content.matchAll(/(?:^|[^\p{L}\p{M}\p{N}_/#])#([\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*)/gu)) {
        tags.set(normalizeSearch(match[1]), match[1]);
      }
    }
  }
  return [...tags.values()];
}
function parseTags(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') value = value.trim().split(/\s+/u).filter(Boolean);
  if (!Array.isArray(value) || value.length > 100) throw createError(400, 'Use up to 100 space-separated tags.');
  const tags = new Map();
  for (let tag of value) {
    if (typeof tag !== 'string') throw createError(400, 'Invalid tag.');
    tag = tag.replace(/^#/, '');
    if (tag.length > 200 || !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*$/u.test(tag)) throw createError(400, 'Separate tags with spaces; use letters, numbers, underscores or hyphens.');
    tags.set(normalizeSearch(tag), tag);
  }
  return [...tags.values()];
}
function storedTags(row) { return row.tags ? JSON.parse(row.tags) : []; }
function allTags(text, tags = []) { return [...new Map([...hashtags(text), ...tags].map(tag => [normalizeSearch(tag), tag])).values()]; }
function searchFields(title, text, tags = []) {
  return [normalizeSearch(`${title}\n${text}`), '\n' + allTags(text, tags).map(normalizeSearch).join('\n') + '\n'];
}
let ready;
function ensureTable() {
  if (!ready) ready = (async () => {
    await global.query(`CREATE TABLE IF NOT EXISTS user_notebook (
    user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    source_key VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    source_title VARCHAR(500) NOT NULL,
    source_url VARCHAR(1000) NOT NULL,
    markdown MEDIUMTEXT NOT NULL,
    title VARCHAR(500) NULL,
    created_at DATETIME(3) NULL,
    tags MEDIUMTEXT NULL,
    search_text MEDIUMTEXT COLLATE utf8mb4_bin NULL,
    search_tags MEDIUMTEXT COLLATE utf8mb4_bin NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_uid, source_key), KEY notebook_updated (user_uid, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const columns = await global.query('SHOW COLUMNS FROM user_notebook');
    for (const [name, definition] of Object.entries({ search_text: 'MEDIUMTEXT COLLATE utf8mb4_bin NULL', search_tags: 'MEDIUMTEXT COLLATE utf8mb4_bin NULL', tags: 'MEDIUMTEXT COLLATE utf8mb4_bin NULL', title: 'VARCHAR(500) NULL', created_at: 'DATETIME(3) NULL' })) {
      if (!columns.some(column => column.Field === name)) {
        try { await global.query(`ALTER TABLE user_notebook ADD COLUMN ${name} ${definition}`); }
        catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
      }
    }
    // An unedited note's modification time is also its creation time.
    await global.query('UPDATE user_notebook SET created_at=updated_at WHERE created_at IS NULL AND version=1');
    // Version checks protect edits made by another running process during backfill.
    while (true) {
      const rows = await global.query('SELECT user_uid, source_key, source_title, title, markdown, tags, version FROM user_notebook WHERE search_text IS NULL OR search_tags IS NULL LIMIT 100');
      if (!rows.length) break;
      for (const row of rows) await global.query(mysql.format('UPDATE user_notebook SET search_text=?, search_tags=? WHERE user_uid=? AND source_key=? AND version=?', [...searchFields([row.source_title, row.title].filter(Boolean).join('\n'), row.markdown, storedTags(row)), row.user_uid, row.source_key, row.version]));
    }
  })().catch(err => { ready = null; throw err; });
  return ready;
}
function key(value) {
  if (typeof value !== 'string' || !/^(general|item:\d+|heading:\d+|intro:\d+|sharh:\d+|heading-sharh:\d+|tafsir:[A-Za-z0-9_-]+:\d+:\d+|tafsir-heading:[A-Za-z0-9_-]+:[\d.]+)$/.test(value) || value.length > 191)
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
function present(row) { return { ...row, html: markdown.render(row.markdown), tags: storedTags(row), hashtags: allTags(row.markdown, storedTags(row)) }; }
async function get(uid, source) {
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT source_key, source_title, source_url, title, markdown, tags, version, created_at, updated_at FROM user_notebook WHERE user_uid=? AND source_key=?', [uid, key(source)]));
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
async function list(uid, offset = 0, query = '', tag = '') {
  if (typeof query !== 'string' || query.length > 500 || typeof tag !== 'string' || tag.length > 200)
    throw createError(400, 'Invalid note search.');
  tag = tag.trim().replace(/^#/, '');
  if (tag && !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*$/u.test(tag)) throw createError(400, 'Invalid hashtag.');
  await ensureTable();
  const conditions = ['user_uid=?'], values = [uid];
  // LOCATE treats %, _ and backslashes literally, unlike LIKE patterns.
  if (query.trim()) { conditions.push('LOCATE(?, search_text)>0'); values.push(normalizeSearch(query.trim())); }
  if (tag) { conditions.push('LOCATE(?, search_tags)>0'); values.push(`\n${normalizeSearch(tag)}\n`); }
  const rows = await global.query(mysql.format(`SELECT source_key, source_title, source_url, title, markdown, tags, version, created_at, updated_at FROM user_notebook WHERE ${conditions.join(' AND ')} ORDER BY (source_key='general') DESC, updated_at DESC, source_key LIMIT 13 OFFSET ?`, [...values, offset]));
  return { notes: rows.slice(0, 12).map(present), hasMore: rows.length > 12 };
}
async function tagList(uid) {
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT search_tags FROM user_notebook WHERE user_uid=?', [uid]));
  const counts = new Map();
  for (const row of rows) for (const tag of new Set((row.search_tags || '').split('\n').filter(Boolean))) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count }));
}
function exportMarkdown(note) {
  const source = key(note.source_key);
  if (typeof note.markdown !== 'string' || Buffer.byteLength(note.markdown, 'utf8') > 65535) throw createError(400, 'Invalid Markdown.');
  let reference = source;
  if (source === 'general') reference = 'general';
  else if (note.source_url) {
    const url = new URL(sourceUrl(note.source_url), 'https://notebook.local');
    reference = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '') || source;
    if (/^quran\/[a-z][a-z0-9_-]*:\d+(?::\d+)?[a-z]?$/i.test(reference)) reference = reference.slice(6);
  }
  // JSON-quoted strings are valid YAML scalars, including numeric/boolean-like tags.
  const scalar = value => /^[\p{L}_][\p{L}\p{M}\p{N}_:/.-]*$/u.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value) ? value : JSON.stringify(value);
  const tags = allTags(note.markdown, parseTags(note.tags));
  const tagYaml = tags.length ? `tags:\n${tags.map(tag => `  - ${scalar(tag)}`).join('\n')}` : 'tags: []';
  const titleYaml = note.title ? `title: ${JSON.stringify(note.title)}\n` : '';
  return `---\n${titleYaml}${tagYaml}\nreference: ${scalar(reference)}\n---\n\n${note.markdown}`;
}
async function exportZip(uid) {
  await ensureTable();
  const rows = await global.query(mysql.format('SELECT source_key, source_title, source_url, title, markdown, tags FROM user_notebook WHERE user_uid=? ORDER BY source_key', [uid]));
  const zip = new (require('adm-zip'))();
  for (const note of rows) {
    const title = (note.title || note.source_title).replace(/[^\p{L}\p{N} _-]/gu, '-').slice(0, 80).trim() || 'Note';
    const identity = key(note.source_key).replace(/:/g, '-');
    zip.addFile(`${title} (${identity}).md`, Buffer.from(exportMarkdown({ ...note, tags: storedTags(note) }), 'utf8'));
  }
  return zip.toBufferPromise();
}
async function save(uid, body) {
  const source = key(body.source_key);
  if (source === 'general') body = { ...body, source_title: 'General note', source_url: '/notebook' };
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 500)) throw createError(400, 'Titles can contain up to 500 characters.');
  if (typeof body.markdown !== 'string' || (!body.markdown.trim() && !body.title?.trim())) throw createError(400, 'Write a note before saving.');
  if (Buffer.byteLength(body.markdown, 'utf8') > 65535) throw createError(413, 'Notes can contain up to 64 KB of Markdown.');
  if (typeof body.source_title !== 'string' || !body.source_title.trim() || body.source_title.length > 500) throw createError(400, 'Invalid source title.');
  const url = sourceUrl(body.source_url);
  if (!Number.isInteger(body.version) || body.version < 0) throw createError(400, 'Invalid note version.');
  await ensureTable();
  const previous = body.version > 0 && (body.tags === undefined || body.title === undefined) ? await get(uid, source) : null;
  const tags = parseTags(body.tags === undefined ? previous?.tags : body.tags);
  const title = (body.title === undefined ? previous?.title : body.title)?.trim() || null;
  const searchableTitle = [body.source_title, title].filter(Boolean).join('\n');
  if (body.version === 0) {
    try { await global.query(mysql.format('INSERT INTO user_notebook (user_uid, source_key, source_title, source_url, markdown, search_text, search_tags, tags, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))', [uid, source, body.source_title, url, body.markdown, ...searchFields(searchableTitle, body.markdown, tags), JSON.stringify(tags), title])); }
    catch (err) { if (err.code === 'ER_DUP_ENTRY') throw createError(409, 'This note changed elsewhere. Reopen it before saving.'); throw err; }
  } else {
    const result = await global.query(mysql.format('UPDATE user_notebook SET markdown=?, source_title=?, source_url=?, search_text=?, search_tags=?, tags=?, title=?, version=version+1, updated_at=CURRENT_TIMESTAMP(3) WHERE user_uid=? AND source_key=? AND version=?', [body.markdown, body.source_title, url, ...searchFields(searchableTitle, body.markdown, tags), JSON.stringify(tags), title, uid, source, body.version]));
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
  return save(uid, { ...body, markdown: `${References.removeReference(body.markdown, ref, markdown)}\n\n${snapshot}\n`.trimStart() });
}
module.exports = { exportMarkdown, parseTags, tagList, normalizeSearch, hashtags, exportZip, status, expand, get, list, save, remove, key, sourceUrl, render: text => markdown.render(text), ensureTable };
