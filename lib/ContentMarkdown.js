'use strict';

const MarkdownIt = require('markdown-it');

// Shared syntax, safe HTML, Arabic typography and block direction for all Markdown surfaces.
function create({ references = false, footnotePrefix = '', propheticSpeech = true } = {}) {
  const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });
  markdown.use(require('markdown-it-footnote'));
  markdown.use(require('./NotebookFormatting'));
  markdown.renderer.rules.em_open = (tokens, index, options, env, renderer) => {
    if (env?.propheticSpeech ?? propheticSpeech) {
      tokens[index].attrJoin('class', tokens[index].markup === '*' ? 'source-prophetic-speech' : 'source-italic');
    }
    return renderer.renderToken(tokens, index, options);
  };
  // Avoid collisions with footnotes in the hadith/Quran page behind the dialog.
  markdown.renderer.rules.footnote_anchor_name = (tokens, index, options, env) => {
    const prefix = String(env?.footnoteIdPrefix || footnotePrefix).replace(/[^a-zA-Z0-9_-]/g, '-');
    return prefix ? `-${prefix}-${tokens[index].meta.id + 1}` : String(tokens[index].meta.id + 1);
  };
  const arabicFootnoteNumber = label => /^[٠-٩۰-۹]+$/.test(label || '')
    ? label.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0))) : null;
  const footnoteCaption = markdown.renderer.rules.footnote_caption;
  markdown.renderer.rules.footnote_caption = (tokens, index, ...args) => {
    const label = tokens[index].meta.label;
    return arabicFootnoteNumber(label) !== null ? `[${label}]` : footnoteCaption(tokens, index, ...args);
  };
  const footnoteOpen = markdown.renderer.rules.footnote_open;
  markdown.renderer.rules.footnote_open = (tokens, index, ...args) => {
    const number = arabicFootnoteNumber(tokens[index].meta.label) || String(tokens[index].meta.id + 1);
    return footnoteOpen(tokens, index, ...args).replace('<li ', `<li value="${number}" `);
  };
  require('./MarkdownHidden')(markdown);
  if (references) require('./NotebookReferences').install(markdown);
  if (references) require('./NotebookWiki').install(markdown);
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    if (!(tokens[index].attrGet('href') || '').startsWith('#')) tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderer.renderToken(tokens, index, options);
  };
  const arabicText = /[\p{Script_Extensions=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script_Extensions=Arabic}\u200c\u200d]+)*/gu;
  const arabicGraphemes = new Intl.Segmenter('ar', { granularity: 'grapheme' });
  function renderArabicText(text, underline = false) {
    if (underline) {
      let html = '', cursor = 0;
      const latin = value => value ? `<span class="notebook-underline">${markdown.utils.escapeHtml(value)}</span>` : '';
      for (const match of text.matchAll(arabicText)) {
        html += latin(text.slice(cursor, match.index));
        const overlined = Array.from(arabicGraphemes.segment(match[0]), ({ segment }) =>
          /\p{L}/u.test(segment) && !segment.includes('\u0305') ? segment + '\u0305' : segment).join('');
        html += `<span class="notebook-arabic" data-notebook-overline>${markdown.utils.escapeHtml(overlined)}</span>`;
        cursor = match.index + match[0].length;
      }
      return html + latin(text.slice(cursor));
    }
    return markdown.utils.escapeHtml(text).replace(arabicText, '<span class="notebook-arabic">$&</span>');
  }
  function renderNotebookText(text, underline = false) {
    let html = '', cursor = 0;
    for (const match of text.matchAll(/۝[٠-٩۰-۹]+/gu)) {
      html += renderArabicText(text.slice(cursor, match.index), underline);
      html += `<span class="quran-ayah-end-marker">${match[0]}</span>`;
      cursor = match.index + match[0].length;
    }
    return html + renderArabicText(text.slice(cursor), underline);
  }
  require('./NotebookHtml')(markdown, renderArabicText);
  markdown.renderer.rules.text = (tokens, index) => renderNotebookText(tokens[index].content, tokens[index].meta?.notebookUnderline);
  markdown.renderer.rules.code_inline = (tokens, index) => {
    const text = tokens[index].content;
    const hasArabic = /\p{Script_Extensions=Arabic}/u.test(text);
    return hasArabic
      ? `<code dir="auto" class="notebook-arabic">${renderArabicText(text)}</code>`
      : `<code>${markdown.utils.escapeHtml(text)}</code>`;
  };
  // Direction is determined independently for each block, including mixed-language notes.
  markdown.core.ruler.push('notebook_direction', state => {
    const blocks = [];
    state.tokens.forEach(token => {
      if (token.nesting === 1) blocks.push({ token, text: '' });
      if (token.type === 'inline') {
        // Use visible labels, never link destinations or Markdown punctuation.
        const text = (token.children || []).map(child =>
          ['text', 'code_inline', 'image'].includes(child.type) ? child.content : '').join(' ');
        for (const block of blocks) block.text += ' ' + text;
      }
      if (token.nesting === -1) {
        const block = blocks.pop();
        if (block && /^(paragraph|heading|blockquote|list_item|bullet_list|ordered_list|dt|dd|th|td)_open$/.test(block.token.type)) {
          const letters = block.text.match(/\p{L}/gu) || [];
          // A quote's edge follows its opening language, even with a translation.
          if (block.token.type === 'blockquote_open' && letters.length)
            block.token.attrSet('dir', /\p{Script_Extensions=Arabic}/u.test(letters[0]) ? 'rtl' : 'ltr');
          else if (letters.length && letters.every(letter => /\p{Script_Extensions=Arabic}/u.test(letter)))
            block.token.attrSet('dir', 'rtl');
        }
      }
      if (token.nesting === 1 && /^(paragraph|heading|blockquote|list_item|dt|dd|th|td)_open$/.test(token.type))
        token.attrSet('dir', 'auto');
      // Mark the final text tokens after reference/link expansion has split them.
      let underlineDepth = 0;
      for (const child of token.children || []) {
        if (child.type === 'u_open') underlineDepth++;
        else if (child.type === 'u_close') underlineDepth--;
        else if (underlineDepth && child.type === 'text') child.meta = { ...child.meta, notebookUnderline: true };
      }
    });
  });
  return markdown;
}

let renderer;
function finish(html, text) {
  html = require('./NotebookDirection')(html);
  if (!String(text || '').includes('@[toc]')) return html;
  const $ = require('cheerio').load(html, null, false);
  require('./CommunityToc')($, text);
  return $.html();
}
function render(text, options = {}) {
  renderer ||= create();
  return finish(renderer.render(String(text || ''), options), text);
}
// Reader text repeats across search, dialogs and page renders. Cache only the
// pure reader options; arbitrary Markdown environments can carry mutable state.
const readerCache = new Map();
const readerCacheLimit = 4 * 1024 * 1024;
let readerCacheBytes = 0;
function renderCached(text, options = {}) {
  if (Object.keys(options).some(key => !['propheticSpeech', 'footnoteIdPrefix'].includes(key))
    || (options.footnoteIdPrefix !== undefined && typeof options.footnoteIdPrefix !== 'string')
    || (options.propheticSpeech !== undefined && typeof options.propheticSpeech !== 'boolean'))
    return render(text, options);
  text = String(text || '');
  if (text.length > 32768) return render(text, options);
  const key = JSON.stringify([options.propheticSpeech ?? true, options.footnoteIdPrefix || '', text]);
  const cached = readerCache.get(key);
  if (cached) {
    readerCache.delete(key);
    readerCache.set(key, cached);
    return cached.html;
  }
  const html = render(text, { ...options });
  const bytes = 2 * (key.length + html.length);
  if (bytes <= readerCacheLimit) {
    while (readerCache.size && (readerCacheBytes + bytes > readerCacheLimit || readerCache.size >= 512)) {
      const oldest = readerCache.keys().next().value;
      readerCacheBytes -= readerCache.get(oldest).bytes;
      readerCache.delete(oldest);
    }
    readerCache.set(key, { html, bytes });
    readerCacheBytes += bytes;
  }
  return html;
}
module.exports = { create, render, renderCached, finish };
