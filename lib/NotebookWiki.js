'use strict';

const normalizeTitle = title => String(title || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

function install(md) {
  md.inline.ruler.before('link', 'notebook_wiki', (state, silent) => {
    if (silent || state.linkLevel || state.src.slice(state.pos, state.pos + 2) !== '[[') return false;
    const match = /^\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]+))?\]\]/.exec(state.src.slice(state.pos));
    if (!match || !match[1].trim() || (match[2] !== undefined && !match[2].trim())) return false;
    if (!silent) {
      const title = match[1].trim();
      const open = state.push('link_open', 'a', 1);
      open.attrs = [['href', '/notebook?note=' + encodeURIComponent(title)], ['data-notebook-wiki', title], ['title', title]];
      state.push('text', '', 0).content = (match[2] || title).trim();
      state.push('link_close', 'a', -1);
    }
    state.pos += match[0].length;
    return true;
  });
}
module.exports = { install, normalizeTitle };
