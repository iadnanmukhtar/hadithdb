'use strict';

// Callouts remain ordinary blockquotes in stored Markdown. Transform tokens,
// never rendered HTML, so titles/body retain safe Markdown and bidi handling.
module.exports = function callouts(markdown) {
  markdown.core.ruler.before('inline', 'markdown_callouts', state => {
    for (let index = 0; index < state.tokens.length; index++) {
      const quote = state.tokens[index];
      if (quote.type !== 'blockquote_open') continue;
      const paragraph = state.tokens[index + 1], first = state.tokens[index + 2];
      if (paragraph?.type !== 'paragraph_open' || first?.type !== 'inline') continue;
      const marker = first.content.match(/^\[!([a-z][a-z0-9_-]*)\][ \t]*/i);
      let end = index + 1, depth = 1;
      for (; end < state.tokens.length; end++) {
        if (state.tokens[end].type === 'blockquote_open') depth++;
        if (state.tokens[end].type === 'blockquote_close' && --depth === 0) break;
      }
      const contents = state.tokens.slice(index + 1, end).filter(token => token.type === 'inline');
      if (!marker && !contents.some(token => /\{\.callout\}/.test(token.content))) continue;
      const kind = marker ? marker[1].toLowerCase() : 'note';
      quote.attrJoin('class', `markdown-callout markdown-callout-${kind}`);
      for (const token of contents) token.content = token.content.replace(/[ \t]*\{\.callout\}/g, '').trimEnd();
      const text = first.content.replace(/^\[![a-z][a-z0-9_-]*\][ \t]*/i, '');
      const newline = text.indexOf('\n');
      const title = (newline < 0 ? text : text.slice(0, newline)).trim();
      const body = newline < 0 ? '' : text.slice(newline + 1);
      first.content = title || kind.charAt(0).toUpperCase() + kind.slice(1);
      paragraph.attrJoin('class', 'markdown-callout-title');
      if (body) {
        const open = new state.Token('paragraph_open', 'p', 1);
        const inline = new state.Token('inline', '', 0);
        inline.content = body; inline.children = [];
        const close = new state.Token('paragraph_close', 'p', -1);
        state.tokens.splice(index + 4, 0, open, inline, close);
      }
    }
  });
};
