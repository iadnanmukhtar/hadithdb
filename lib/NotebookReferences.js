'use strict';
const createError = require('http-errors');
const mysql = require('mysql');
const { Item } = require('./Model');
const { load } = require('cheerio');
const REF = /^(?:quran:\d{1,3}:\d{1,3}(?:-\d{1,3})?|[a-z][a-z0-9_-]*:\d+[a-z]?)$/i;
const EXPANDED_TITLE = 'Expanded reference';
const sourceMarkdown = new (require('markdown-it'))({ html: false, breaks: true });
function reference(value) {
  const ref = typeof value === 'string' ? value.toLowerCase() : '';
  if (!REF.test(ref)) throw createError(400, 'Use an exact reference such as bukhari:100 or quran:2:255.');
  const ayahs = /^quran:(\d+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (ayahs && (+ayahs[1] < 1 || +ayahs[1] > 114 || +ayahs[2] < 1 || +(ayahs[3] || ayahs[2]) > 286 || +(ayahs[3] || ayahs[2]) < +ayahs[2])) {
    throw createError(400, 'Use a valid Quran ayah or ascending ayah range.');
  }
  return ref;
}
function install(md) {
  md.core.ruler.push('notebook_references', state => {
    const expanded = new Set();
    const refs = new Set();
    let quoteDepth = 0;
    for (const block of state.tokens) {
      if (block.type === 'blockquote_open') quoteDepth++;
      if (block.type === 'blockquote_close') quoteDepth--;
      const children = block.children || [];
      for (const [index, token] of children.entries()) {
        // New quotations use a plain bold reference link; recognize older markers too.
        const quotedReference = quoteDepth > 0 && children[index - 1]?.type === 'strong_open';
        if (token.type === 'link_open' && (token.attrGet('title') === EXPANDED_TITLE || quotedReference)) {
          const href = token.attrGet('href') || '';
          if (href.startsWith('/') && REF.test(href.slice(1))) expanded.add(href.slice(1).toLowerCase());
        }
      }
    }
    function button(ref) {
      refs.add(ref);
      if (expanded.has(ref)) return [];
      const token = new state.Token('html_inline', '', 0);
      token.content = ` <button type="button" class="notebook-expand-reference btn btn-sm btn-link p-0" data-notebook-reference="${md.utils.escapeHtml(ref)}" title="Expand reference" aria-label="Expand ${md.utils.escapeHtml(ref)}"><span class="bi bi-arrows-angle-expand" aria-hidden="true"></span></button>`;
      return [token];
    }
    for (const block of state.tokens) {
      if (!block.children) continue;
      const output = [];
      let inLink = false, linkedRef = null;
      for (const token of block.children) {
        if (token.type === 'link_open') {
          inLink = true;
          const href = token.attrGet('href') || '';
          linkedRef = href.startsWith('/') && REF.test(href.slice(1)) ? href.slice(1).toLowerCase() : null;
        }
        if (token.type === 'link_close') {
          output.push(token);
          if (linkedRef) refs.add(linkedRef);
          inLink = false; linkedRef = null; continue;
        }
        if (token.type !== 'text' || inLink) { output.push(token); continue; }
        const pattern = /(?<![\w/:.-])(?:quran:\d{1,3}:\d{1,3}(?:-\d{1,3})?|[a-z][a-z0-9_-]*:\d+[a-z]?)(?![\w:–-])/gi;
        let offset = 0;
        for (const match of token.content.matchAll(pattern)) {
          const ref = match[0].toLowerCase();
          const alias = ref.split(':')[0];
          if (alias === 'quran' && ref.split(':').length !== 3) continue;
          if (alias !== 'quran' && !(global.books || []).some(book => book.alias === alias)) continue;
          if (match.index > offset) { const text = new state.Token('text', '', 0); text.content = token.content.slice(offset, match.index); output.push(text); }
          const open = new state.Token('link_open', 'a', 1); open.attrSet('href', `/${ref}`);
          const text = new state.Token('text', '', 0); text.content = match[0];
          output.push(open, text, new state.Token('link_close', 'a', -1), ...button(ref));
          offset = match.index + match[0].length;
        }
        if (offset < token.content.length) { const text = new state.Token('text', '', 0); text.content = token.content.slice(offset); output.push(text); }
      }
      block.children = output;
    }
    state.env.notebookReferences = refs;
    state.env.notebookExpandedReferences = expanded;
  });
}
function replaceReference(source, ref, md, replacement = '') {
  // Only process prose blocks; fenced and indented code remain verbatim.
  const lines = source.split('\n');
  const edits = [];
  for (const block of md.parse(source, {})) {
    if (block.type !== 'inline' || !block.map) continue;
    const start = lines.slice(0, block.map[0]).join('\n').length + (block.map[0] ? 1 : 0);
    const end = lines.slice(0, block.map[1]).join('\n').length;
    if (edits.some(edit => edit.start === start)) continue;
    const original = source.slice(start, end);
    // Keep code spans and unrelated links/URLs intact, including their labels.
    const pattern = /(`+)[\s\S]*?\1(?!`)|\[(?:[^\]\n]|\[[^\]\n]*\])*\]\((?:[^()\n]|\([^()\n]*\))*\)|(?:https?:\/\/|www\.)[^\s<>]+|(?<![\w/:.\-\\])(?:quran:\d{1,3}:\d{1,3}(?:-\d{1,3})?|[a-z][a-z0-9_-]*:\d+[a-z]?)(?![\w:–-])/gi;
    const text = original.replace(pattern, (match, code) => {
      if (code || /^(?:https?:\/\/|www\.)/i.test(match)) return match;
      if (match.startsWith('[')) {
        const tokens = md.parseInline(match, {})[0]?.children || [];
        return tokens.some(token => token.type === 'link_open' && token.attrGet('href')?.toLowerCase() === `/${ref}`) ? (replacement ? match : '') : match;
      }
      return match.toLowerCase() === ref ? (replacement ? `\n\n${replacement}\n\n` : '') : match;
    });
    edits.push({ start, end, text });
  }
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source.trimEnd();
}
function clean(value) {
  // Strip source HTML first, then flatten Markdown to text while retaining paragraphs.
  const source = load(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div)>/gi, '\n\n'));
  source('script,style').remove();
  const rendered = load(sourceMarkdown.render(source.root().text()));
  rendered('img').each((_, node) => { rendered(node).replaceWith(rendered(node).attr('alt') || ''); });
  rendered('br').replaceWith('\n');
  rendered('p,h1,h2,h3,h4,h5,h6,pre,blockquote,ul,ol,table').append('\n\n');
  rendered('li,tr').append('\n');
  rendered('td,th').append(' ');
  return rendered.root().text().replace(/==([^=\n]+)==/g, '$1')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    // Literal punctuation in code or escaped source text must not become new Markdown.
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]#!|~]/g, character => `&#${character.charCodeAt(0)};`);
}

async function snapshot(value) {
  const ref = reference(value);
  const range = /^quran:(\d+):(\d+)-(\d+)$/.exec(ref);
  if (range) {
    const verses = [];
    for (let ayah = +range[2]; ayah <= +range[3]; ayah++) {
      verses.push(await snapshot(`quran:${range[1]}:${ayah}`));
    }
    return `> **[${ref}](/${ref})**\n>\n${verses.join('\n>\n')}`;
  }
  let item;
  try { item = await Item.itemFromRef(ref); }
  catch (err) { if (err instanceof ReferenceError) throw createError(404, `Reference ${ref} was not found.`); throw err; }
  if (!item || String(item.ref).toLowerCase() !== ref) throw createError(404, `Reference ${ref} was not found.`);
  // Refresh native records from the database so saved quotations use current source text.
  if (!item.book_virtual && Number.isInteger(Number(item.id)) && item.book_id != null) {
    const rows = await global.query(mysql.format('SELECT chain, body, footnote, chain_en, body_en, footnote_en FROM hadiths WHERE id=? AND bookId=?', [item.id, item.book_id]));
    if (!rows.length) throw createError(404, `Reference ${ref} was not found.`);
    item = { ...item, ar: { chain: rows[0].chain, body: rows[0].body, footnote: rows[0].footnote }, en: { chain: rows[0].chain_en, body: rows[0].body_en, footnote: rows[0].footnote_en } };
  }
  const arabic = [item.ar?.chain, item.ar?.body].map(clean).filter(Boolean).join('\n\n');
  const english = [item.en?.chain, item.en?.body].map(clean).filter(Boolean).join('\n\n');
  if (!arabic && !english) throw createError(404, `No text is available for ${ref}.`);
  const parts = [`**[${ref}](/${ref})**`, arabic || 'Arabic text is unavailable.', english || 'English translation is unavailable.'];
  if (item.ar?.footnote) parts.push(clean(item.ar.footnote));
  if (item.en?.footnote) parts.push(clean(item.en.footnote));
  return parts.join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
}
module.exports = { install, snapshot, reference, replaceReference, removeReference: (source, ref, md) => replaceReference(source, ref, md) };
