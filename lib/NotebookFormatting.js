'use strict';

// Note-only extensions; raw HTML remains disabled in the Markdown renderer.
module.exports = function install(markdown) {
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
