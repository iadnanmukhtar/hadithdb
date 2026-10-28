(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CommunityBio = factory();
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const limit = 150;
  const normalize = value => String(value || '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
  const length = value => Array.from(normalize(value)).length;
  function links(value) {
    const result = [];
    for (const match of value.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
      const text = match[0].replace(/[.,!?;:]+$/, '');
      try {
        const url = new URL(/^www\./i.test(text) ? 'https://' + text : text);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
          result.push({start:match.index, text, href:url.href});
      } catch (_) { /* Invalid addresses remain plain text. */ }
    }
    return result;
  }
  function error(value) {
    if (typeof value !== 'string') return 'Bio must be text.';
    const text = normalize(value);
    if (length(text) > limit) return 'Keep your bio to 150 characters or fewer.';
    if (text.split('\n').length > 3) return 'Use no more than 3 lines in your bio.';
    if (/<\/?[a-z][^>]*>/i.test(text)) return 'Use plain text and web links, without HTML.';
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) return 'Remove hidden control characters from your bio.';
    if (/\b(?:javascript|vbscript|data|file):/i.test(text)) return 'Use http:// or https:// web links in your bio.';
    if (links(text).length > 5) return 'Use no more than 5 links in your bio.';
    return '';
  }
  function render(element, value) {
    if (!element) return;
    // Bound legacy bios without modifying stored text; create no user HTML.
    const full = normalize(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').split('\n').slice(0, 3).join('\n');
    const text = Array.from(full).slice(0, limit).join('');
    element.replaceChildren();
    const document = element.ownerDocument;
    let offset = 0;
    for (const link of links(full).filter(link => link.start + link.text.length <= text.length)) {
      element.append(document.createTextNode(text.slice(offset, link.start)));
      const anchor = document.createElement('a');
      anchor.textContent = link.text; anchor.href = link.href;
      anchor.target = '_blank'; anchor.rel = 'ugc nofollow noopener noreferrer';
      element.append(anchor); offset = link.start + link.text.length;
    }
    element.append(document.createTextNode(text.slice(offset)));
  }
  return {limit, normalize, length, error, links, render};
});
