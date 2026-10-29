(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContentLabels = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Inputs are display text, not HTML. Server callers normalize markup first.
  function join(parts, separator) {
    return parts.map(value => String(value == null ? '' : value).trim()).filter(Boolean).join(separator);
  }
  function label(name, reference) { return join([name, reference], ' '); }
  function range(first, last) {
    first = String(first || '').replace(/^quran:/, '');
    last = String(last || first).replace(/^quran:/, '');
    if (!first || first === last) return first;
    const sameSurah = first.includes(':') && first.split(':')[0] === last.split(':')[0];
    return first + '-' + (sameSurah ? last.split(':')[1] : last);
  }
  function qualifiedTitle(reference, heading) {
    return reference === heading ? reference : join([reference, heading], ' — ');
  }
  return {join, label, range, qualifiedTitle};
});
