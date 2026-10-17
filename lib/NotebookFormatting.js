'use strict';

// Note-only Markdown extensions; native HTML is filtered by NotebookHtml.
module.exports = function install(markdown) {
  markdown.set({ linkify: true, highlight(code, language) {
    const hljs = require('highlight.js');
    return language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '';
  } });
  markdown.use(require('markdown-it-deflist'));
  markdown.use(require('markdown-it-task-lists'));
  markdown.use(require('markdown-it-emoji').full);
  markdown.use(require('markdown-it-sub'));
  markdown.use(require('markdown-it-sup'));

  markdown.block.ruler.before('list', 'notebook_subtext', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!/^-# +/.test(line)) return false;
    if (silent) return true;
    const open = state.push('paragraph_open', 'p', 1);
    open.attrSet('class', 'notebook-subtext');
    open.map = [start, start + 1];
    const inline = state.push('inline', '', 0);
    inline.content = line.replace(/^-# +/, '');
    inline.children = [];
    inline.map = [start, start + 1];
    state.push('paragraph_close', 'p', -1);
    state.line = start + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  markdown.core.ruler.before('inline', 'notebook_subtext_visibility', state => {
    state.tokens.forEach((token, index) => {
      if (token.type === 'paragraph_open' && token.attrGet('class') === 'notebook-subtext') {
        token.hidden = false;
        state.tokens[index + 2].hidden = false;
      }
    });
  });

  // Accept only a heading ID, rather than arbitrary HTML attributes.
  markdown.core.ruler.before('inline', 'notebook_heading_ids', state => {
    const used = new Set();
    for (let i = 0; i < state.tokens.length - 1; i++) {
      if (state.tokens[i].type !== 'heading_open') continue;
      const inline = state.tokens[i + 1];
      const match = inline.content.match(/\s+\{#([\p{L}_][\p{L}\p{N}_:.-]*)\}\s*$/u);
      if (!match) continue;
      inline.content = inline.content.slice(0, match.index);
      let id = match[1], suffix = 2;
      while (used.has(id)) id = `${match[1]}-${suffix++}`;
      used.add(id);
      state.tokens[i].attrSet('id', id);
    }
  });

  // Parse each side as Markdown blocks so headings, lists and direction retain
  // the same behavior as ordinary notes. Code spans and escaped pipes are literal.
  function separator(line) {
    let code = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '`') {
        let end = i;
        while (line[end] === '`') end++;
        const length = end - i;
        if (!code) code = length;
        else if (code === length) code = 0;
        i = end - 1;
      } else if (!code && line.slice(i, i + 2) === '||') return i;
    }
    return -1;
  }
  markdown.block.ruler.before('table', 'notebook_parallel', (state, start, end, silent) => {
    if (state.env.notebookParallelCell || state.sCount[start] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    const split = separator(line);
    if (split < 0) return false;
    if (silent) return true;
    const open = state.push('notebook_parallel_open', 'div', 1);
    open.attrSet('class', 'notebook-parallel');
    open.attrSet('dir', 'ltr');
    open.map = [start, start + 1];
    let headingTag;
    for (const [column, content] of [line.slice(0, split), line.slice(split + 2)].entries()) {
      const cell = state.push('notebook_parallel_cell_open', 'div', 1);
      cell.attrSet('class', 'notebook-parallel-cell');
      cell.attrSet('dir', 'auto');
      // This row has already consumed its separator; nested parallel rows are
      // intentionally left to subsequent source lines.
      state.env.notebookParallelCell = true;
      try {
        const startToken = state.tokens.length;
        markdown.block.parse(content.trim(), markdown, state.env, state.tokens);
        const first = state.tokens[startToken];
        if (column === 0 && first?.type === 'heading_open') headingTag = first.tag;
        if (column === 1 && headingTag && /^(paragraph|heading)_open$/.test(first?.type)) {
          const close = state.tokens.slice(startToken + 1).find(token => /^(paragraph|heading)_close$/.test(token.type));
          first.type = 'heading_open'; first.tag = headingTag;
          close.type = 'heading_close'; close.tag = headingTag;
        }
      }
      finally { delete state.env.notebookParallelCell; }
      state.push('notebook_parallel_cell_close', 'div', -1);
    }
    state.push('notebook_parallel_close', 'div', -1);
    state.line = start + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  markdown.inline.ruler.before('emphasis', 'notebook_mark', (state, silent) => {
    if (silent || state.src.charCodeAt(state.pos) !== 0x3d) return false;
    const run = state.scanDelims(state.pos, true);
    if (run.length !== 2) return false;
    const token = state.push('text', '', 0);
    token.content = '==';
    state.delimiters.push({ marker: 0x3d, length: 0, token: state.tokens.length - 1,
      end: -1, open: run.can_open, close: run.can_close });
    state.pos += 2;
    return true;
  });
  markdown.inline.ruler2.before('emphasis', 'notebook_mark', state => {
    const process = delimiters => {
      for (const start of delimiters) {
        if (start.marker !== 0x3d || start.end < 0) continue;
        const end = delimiters[start.end];
        for (const [delimiter, nesting] of [[start, 1], [end, -1]]) {
          const token = state.tokens[delimiter.token];
          token.type = nesting === 1 ? 'mark_open' : 'mark_close';
          token.tag = 'mark'; token.nesting = nesting; token.markup = '=='; token.content = '';
        }
      }
    };
    process(state.delimiters);
    for (const meta of state.tokens_meta) if (meta?.delimiters) process(meta.delimiters);
  });

  // Only the exact attribute-free underline tags are recognized. Escapes, code,
  // and all other HTML continue through the standard Markdown rules.
  markdown.inline.ruler.before('html_inline', 'notebook_underline', (state, silent) => {
    const match = state.src.slice(state.pos).match(/^<\/?u>/i);
    if (!match) return false;
    if (!silent) {
      const token = state.push('notebook_underline_literal', '', 0);
      token.content = match[0];
    }
    state.pos += match[0].length;
    return true;
  });
  markdown.core.ruler.after('inline', 'notebook_underlines', state => {
    for (const block of state.tokens) {
      const stack = [];
      for (const token of block.children || []) {
        if (token.type === 'strong_open' || token.type === 'strong_close') {
          if (token.markup === '__') { token.tag = 'u'; token.type = token.nesting === 1 ? 'u_open' : 'u_close'; }
        }
        if (token.type !== 'notebook_underline_literal') continue;
        token.type = 'text';
        if (token.content.toLowerCase() === '<u>') stack.push(token);
        else if (stack.length) {
          const open = stack.pop();
          open.type = 'u_open'; open.tag = 'u'; open.nesting = 1; open.content = '';
          token.type = 'u_close'; token.tag = 'u'; token.nesting = -1; token.content = '';
        }
      }
    }
  });
};
