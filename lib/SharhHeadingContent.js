'use strict';
// Source navigation labels are not explanations. Compare whole lines, never
// discard a passage merely because it is short or begins with its heading.
function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function isHeadingOnly(text, title, aliases = []) {
  const headings = new Set([title, ...aliases].map(normalize));
  const lines = String(text || '').split(/\r?\n/).map(normalize).filter(Boolean);
  return lines.length === 0 || lines.every(line => headings.has(line) || /^الفصل (?:الاول|الثاني|الثالث)$/.test(line));
}
function isMishkatHeadingOnly(source, passage) {
  // Reviewed spelling variants in these specific EPUBs, not fuzzy prose matching.
  const aliases = source === 'mirqat' && passage.file === 2600 ? ['باب ما تجب فيه الزكاة']
    : source === 'miraat' && passage.file === 2735 ? ['باب من لا تحل له المسألة ومن تحله له'] : [];
  return isHeadingOnly(passage.text, passage.title, aliases);
}
module.exports = { normalize, isHeadingOnly, isMishkatHeadingOnly };
