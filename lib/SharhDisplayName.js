'use strict';

// Display labels are derived from separate title/author fields, never persisted as names.
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’]s\b/g, '').replace(/[ʿʾ‘’ʼ']/g, '').replace(/\bs\b/g, '').replace(/\bal[-\s]+/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizeArabic(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/ـ/g, '').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function authorSuffix(book, title, language = 'en') {
  const author = String((language === 'ar' ? book?.authorShortName : book?.authorShortName_en) || '').trim();
  if (!author) return '';
  const normalizer = language === 'ar' ? normalizeArabic : normalize;
  const name = normalizer(title);
  const personal = normalizer(author.replace(/\s+(?:and (?:colleagues|team)|foundation|team|وآخرون)$/i, ''));
  const tokens = personal.split(' ').filter(Boolean);
  const surname = tokens[tokens.length - 1];
  // A distinctive family/attribution name also covers expanded short names:
  // Sharh al-Suyuti already identifies Jalal al-Din al-Suyuti.
  const words = new Set(name.split(' '));
  if (personal && (` ${name} `).includes(` ${personal} `) || surname && surname.length >= 4 && words.has(surname)) return '';
  return ` (${author})`;
}
function displayName(book, title, language = 'en') {
  const name = String(title || (language === 'ar' ? book?.shortName || book?.name || book?.title : book?.shortName_en || book?.name_en || book?.title_en) || book?.alias || '').trim();
  return name + authorSuffix(book, name, language);
}
module.exports = { authorSuffix, displayName };
