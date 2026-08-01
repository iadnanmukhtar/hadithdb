'use strict';

function tafsirSlug(alias) {
  return (alias || '').toString().replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (err) {
    return '';
  }
}

function canonicalPath(requestPath, commentaries) {
  const segments = (requestPath || '').toString().split('/').filter(Boolean);
  let aliasIndex = 0;
  if (segments[0] === 'quran') {
    if (segments[1] === 'tafsir')
      return '';
    aliasIndex = 1;
  } else if (segments[0] === 'tafsir') {
    aliasIndex = 1;
  }

  const requestedAlias = decodeSegment(segments[aliasIndex]);
  if (!requestedAlias)
    return '';

  const tafsir = (commentaries || []).find(book => book
    && book.type === 'tafsir'
    && Number(book.hidden) === 0
    && (book.alias === requestedAlias
      || book.slug === requestedAlias
      || tafsirSlug(book.alias) === requestedAlias));
  if (!tafsir)
    return '';

  const slug = tafsir.slug || tafsirSlug(tafsir.alias);
  const remainder = segments.slice(aliasIndex + 1).map(decodeSegment);
  if (!slug || remainder.some(segment => !segment))
    return '';
  return `/quran/tafsir/${[slug].concat(remainder).map(encodeURIComponent).join('/')}`;
}

module.exports = {
  canonicalPath
};
