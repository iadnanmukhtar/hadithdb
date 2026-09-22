'use strict';
const createError = require('http-errors');
const mysql = require('mysql');
const { Item } = require('./Model');
const { load } = require('cheerio');
const REF = /^(?:quran:\d{1,3}:\d{1,3}(?:-\d{1,3})?|[a-z][a-z0-9_-]*:\d+[a-z]?)$/i;
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
    const refs = new Set();
    const expandable = new Set();
    function button(ref) {
      refs.add(ref);
      expandable.add(ref);
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
    state.env.notebookExpandableReferences = expandable;
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

const arabicDigits = value => String(value).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[digit]);
const quote = text => text.split('\n').map(line => `> ${line}`).join('\n');
async function sourceItem(ref) {
  let item;
  try { item = await Item.itemFromRef(ref); }
  catch (err) { if (err instanceof ReferenceError) throw createError(404, `Reference ${ref} was not found.`); throw err; }
  if (!item || String(item.ref).toLowerCase() !== ref) throw createError(404, `Reference ${ref} was not found.`);
  // Refresh native records from the database so saved quotations use current source text.
  if (!item.book_virtual && Number.isInteger(Number(item.id)) && item.book_id != null) {
    const rows = await global.query(mysql.format('SELECT chain, body, body_ar_alt, footnote, chain_en, body_en, footnote_en, title_en FROM hadiths WHERE id=? AND bookId=?', [item.id, item.book_id]));
    if (!rows.length) throw createError(404, `Reference ${ref} was not found.`);
    item = { ...item, ar: { ...item.ar, chain: rows[0].chain, body: rows[0].body, body_alt: rows[0].body_ar_alt, footnote: rows[0].footnote }, en: { ...item.en, title: rows[0].title_en ?? item.en?.title, chain: rows[0].chain_en, body: rows[0].body_en, footnote: rows[0].footnote_en } };
  }
  if (!clean(item.ar?.body) && !clean(item.en?.body)) throw createError(404, `No text is available for ${ref}.`);
  return item;
}
async function snapshot(value) {
  const ref = reference(value);
  const passage = /^quran:(\d+):(\d+)(?:-(\d+))?$/.exec(ref);
  const parts = [];
  const items = [];
  let heading = '';
  if (passage) {
    const start = +passage[2], end = +(passage[3] || start);
    for (let ayah = start; ayah <= end; ayah++) items.push(await sourceItem(`quran:${passage[1]}:${ayah}`));
    const name = clean(items[0].ar?.h1_title || items[0].h1_title || 'القرآن');
    const label = `${name} ${arabicDigits(ref.slice(6))}`;
    const arabic = items.map((item, index) => `${clean(item.ar?.body_alt || item.ar?.body).replace(/^[﴿\s]+|[﴾\s]+$/g, '') || 'النص العربي غير متوفر'} ۝${arabicDigits(start + index)}`).join(' ');
    const english = items.map((item, index) => `${items.length > 1 ? (index === 0 ? `${passage[1]}:${start}` : start + index) + ' ' : ''}${clean(item.en?.body) || 'English translation is unavailable.'}`).join(' ');
    parts.push(`﴿ ${arabic} ﴾ ([${label}](/${ref}))`, english);
  } else {
    const item = await sourceItem(ref);
    items.push(item);
    const title = clean(item.en?.title || item.title_en);
    if (title) heading = `**Hadith: ${title}**\n\n`;
    const label = `${clean(item.ar?.book_shortName || item.book_shortName || item.ar?.book_name || item.book_name || ref.split(':')[0])} ${arabicDigits(ref.split(':')[1])}`;
    const arabic = clean(item.ar?.body) || 'النص العربي غير متوفر';
    const grade = clean(item.ar?.grade_grade || item.grade_grade);
    const body = clean(item.en?.body).split('\n\n').map(paragraph => paragraph ? `*${paragraph}*` : '').join('\n\n');
    const english = [clean(item.en?.chain), body].filter(Boolean).join(' ');
    parts.push(`${arabic} ([${label}](/${ref})${grade ? ` ${grade}` : ''})`, english || 'English translation is unavailable.');
  }
  for (const item of items) {
    if (item.ar?.footnote) parts.push(clean(item.ar.footnote));
    if (item.en?.footnote) parts.push(clean(item.en.footnote));
  }
  return heading + quote(parts.join('\n\n'));
}
module.exports = { install, snapshot, reference, replaceReference, removeReference: (source, ref, md) => replaceReference(source, ref, md) };
