'use strict';
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const purify = require('dompurify')(window);
const { load } = require('cheerio');
const tags = ['a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite',
  'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'time', 'tr', 'u', 'ul', 'var'];
const attributes = {
  '*': ['id', 'title', 'dir', 'lang', 'style'],
  a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'],
  ol: ['start', 'reversed', 'type'], li: ['value'], details: ['open']
};
const styles = {
  color: /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i,
  'background-color': /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i,
  'text-align': /^(?:left|right|center|start|end|justify)$/,
  'font-weight': /^(?:normal|bold|[1-9]00)$/,
  'font-style': /^(?:normal|italic)$/,
  'text-decoration': /^(?:none|underline|overline|line-through)$/,
  'font-size': /^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)|small|smaller|large|larger)$/
};
purify.addHook('uponSanitizeAttribute', (node, data) => {
  const allowed = [...attributes['*'], ...(attributes[node.localName] || [])];
  if (!allowed.includes(data.attrName)) data.keepAttr = false;
  if (data.attrName === 'style') {
    const parsed = window.document.createElement('span').style;
    parsed.cssText = data.attrValue;
    data.attrValue = Object.entries(styles).flatMap(([name, pattern]) => {
      const value = parsed.getPropertyValue(name);
      return pattern.test(value) ? [`${name}:${value}`] : [];
    }).join(';');
  }
  if (['href', 'src'].includes(data.attrName)) {
    const url = data.attrValue.replace(/[\u0000-\u0020]/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) && !/^(?:https?:|mailto:|tel:)/i.test(url)) data.keepAttr = false;
  }
});
purify.addHook('afterSanitizeAttributes', node => {
  if (node.localName === 'a') node.setAttribute('rel', 'noopener noreferrer');
  if (node.localName === 'u') node.setAttribute('class', 'notebook-underline');
});
function sanitize(html) {
  return purify.sanitize(html, { ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [...new Set(Object.values(attributes).flat())],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, ADD_DATA_URI_TAGS: [] });
}
module.exports = function install(markdown, renderText) {
  markdown.set({ html: true });
  // Mark source HTML before extensions generate their own trusted HTML tokens.
  markdown.core.ruler.after('inline', 'notebook_source_html', state => {
    for (const block of state.tokens) for (const token of block.children || []) {
      if (token.type === 'html_inline') token.meta = { ...token.meta, notebookSourceHtml: true };
    }
  });
  markdown.renderer.rules.html_inline = (tokens, index) => {
    const html = tokens[index].content;
    if (!tokens[index].meta?.notebookSourceHtml) return html;
    const close = html.match(/^<\/([a-z][\w-]*)\s*>$/i);
    if (close) return tags.includes(close[1].toLowerCase()) ? html : '';
    // Inline tokens contain a single tag. Discard the sanitizer's auto-closing
    // tag; the matching source closing token retains the original nesting.
    const safe = sanitize(html);
    return safe.match(/^<(?:[^>"']|"[^"]*"|'[^']*')+>/)?.[0] || '';
  };
  markdown.renderer.rules.html_block = (tokens, index) => {
    const $ = load(sanitize(tokens[index].content), null, false);
    const visit = node => {
      if (node.type === 'text') {
        if (!$(node).parents('pre, code').length) $(node).replaceWith(renderText(node.data, $(node).parents('u').length > 0));
      } else for (const child of [...(node.children || [])]) visit(child);
    };
    for (const node of $.root().contents().toArray()) visit(node);
    $('p, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, blockquote').each((_, el) => {
      if ($(el).attr('dir')) return;
      const letters = $(el).text().match(/\p{L}/gu) || [];
      const arabic = letter => /\p{Script_Extensions=Arabic}/u.test(letter);
      $(el).attr('dir', el.tagName === 'blockquote' && letters.length
        ? (arabic(letters[0]) ? 'rtl' : 'ltr')
        : (letters.length && letters.every(arabic) ? 'rtl' : 'auto'));
    });
    return $.html();
  };
};
