'use strict';
const yaml = require('js-yaml');
const createError = require('http-errors');
function parse(text, internal = false) {
  if (!/^---\r?\n/.test(text)) return { attributes: {}, body: text, header: '', raw: '', eol: '\n' };
  const match = /^(---\r?\n)([\s\S]*?)(^---(?:\r?\n|$))/m.exec(text);
  if (!match) throw createError(400, 'Close YAML frontmatter with a line containing ---.');
  let attributes;
  try { attributes = yaml.safeLoad(match[2], { schema: yaml.JSON_SCHEMA }) ?? {}; }
  catch (err) { throw createError(400, `Invalid YAML frontmatter: ${err.reason || 'check its syntax'}.`); }
  if (typeof attributes !== 'object' || Array.isArray(attributes)) throw createError(400, 'Frontmatter must contain named fields.');
  if (!internal && Object.hasOwn(attributes, 'hadithunlocked')) throw createError(400, 'The hadithunlocked frontmatter field is reserved.');
  return { attributes, body: text.slice(match[0].length), header: match[0], raw: match[2], eol: match[1].endsWith('\r\n') ? '\r\n' : '\n' };
}
// Exports also consolidate older notes with consecutive metadata blocks.
// Once ordinary Markdown begins, later --- separators belong to the body.
function exportFields(text) {
  const leading = text.replace(/^\uFEFF?(?:[ \t]*\r?\n)*/, '');
  const first = parse(leading);
  if (!first.header) return { ...first, body: text };
  let attributes = linkFields(first.attributes), body = first.body;
  while (true) {
    const nextText = body.replace(/^(?:[ \t]*\r?\n)*/, '');
    let next;
    try { next = parse(nextText); } catch (_) { break; }
    if (!next.header || !Object.keys(next.attributes).length) break;
    next.attributes = linkFields(next.attributes);
    const merged = { ...attributes, ...next.attributes };
    for (const field of ['tags', 'links']) {
      if (Array.isArray(attributes[field]) && Array.isArray(next.attributes[field]))
        merged[field] = [...new Map([...attributes[field], ...next.attributes[field]].map(value => [JSON.stringify(value), value])).values()];
    }
    attributes = merged; body = next.body;
  }
  return { ...first, attributes, body };
}
function serialize(attributes, body) {
  try {
    return `---\n${yaml.safeDump(attributes, { schema: yaml.JSON_SCHEMA, noRefs: true, lineWidth: -1, noCompatMode: true })}---\n${body}`;
  } catch (_) { throw createError(400, 'Frontmatter must not contain circular YAML aliases.'); }
}
const systemFields = ['hadithunlocked', 'source_key', 'source_title', 'source_url', 'version', 'revision', 'cksum', 'content_checksum', 'created_at', 'updated_at', 'user_uid', 'driveFileUrl', 'editor_frontmatter', 'needsChecksum', 'lifetime_created', 'reference', 'links_explicit', 'hashtags', '_id', '_etag'];
function assertEditable(attributes) {
  for (const field of systemFields) if (Object.hasOwn(attributes, field)) throw createError(400, `${field} is system metadata and cannot be edited in frontmatter.`);
}
function linkFields(attributes) {
  const result = { ...attributes };
  if (Object.hasOwn(result, 'attachments')) {
    if (Object.hasOwn(result, 'links') && JSON.stringify(result.links) !== JSON.stringify(result.attachments))
      throw createError(400, 'Use one links list; links and legacy attachments disagree.');
    if (!Object.hasOwn(result, 'links')) result.links = result.attachments;
    delete result.attachments;
  }
  return result;
}
function linkedItems(note) {
  const entries = note.attachments || [];
  const origin = !note.links_explicit && note.source_key && !note.source_key.startsWith('general') && note.source_url
    ? [{ source_key: note.source_key, source_title: note.source_title || note.source_key, source_url: note.source_url }] : [];
  return [...new Map([...origin, ...entries].map(entry => [entry.source_key, entry])).values()];
}
function withMetadata(text, metadata) {
  const data = parse(text);
  assertEditable(data.attributes);
  if (!Object.hasOwn(data.attributes, 'attachments') && Object.entries(metadata).every(([key, value]) => JSON.stringify(data.attributes[key]) === JSON.stringify(value))) return text;
  return serialize({ ...linkFields(data.attributes), ...metadata }, data.body);
}
function withAttachments(text, values) {
  const data = parse(text);
  let raw;
  try { raw = yaml.safeDump({ ...linkFields(data.attributes), links: values }, { schema: yaml.JSON_SCHEMA, noRefs: true, lineWidth: -1, noCompatMode: true }); }
  catch (_) { throw createError(400, 'Frontmatter must not contain circular YAML aliases.'); }
  return `---\n${raw}---\n${data.body}`;
}
function attachmentValues(entries) {
  return entries.map(entry => {
    const path = new URL(entry.source_url, 'https://notebook.local').pathname;
    return /^\/(?:quran:\d+:\d+|[a-z][a-z0-9_-]*:\d+[a-z]?)$/i.test(path) ? path.slice(1) : entry;
  });
}
module.exports = { linkFields, linkedItems, assertEditable, withMetadata, exportFields, serialize, parse, withAttachments, attachmentValues };
