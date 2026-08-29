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

function bookProperties(book) {
  let properties = book && book.properties;
  if (Buffer.isBuffer(properties))
    properties = properties.toString();
  if (typeof properties === 'string') {
    try {
      properties = JSON.parse(properties);
    } catch (_err) {
      return {};
    }
  }
  return properties && typeof properties === 'object' && !Array.isArray(properties) ? properties : {};
}

function isAlsoTranslation(book) {
  const properties = bookProperties(book);
  const displayAs = properties.quran && Array.isArray(properties.quran.display_as)
    ? properties.quran.display_as
    : [];
  return displayAs.some(role => ['trans', 'translation'].includes((role || '').toString().toLowerCase()));
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

  // Under /quran, a dual-role book alias belongs to the Translation reader.
  // Its Tafsir reader remains explicitly available under /quran/tafsir/:slug.
  if (segments[0] === 'quran' && isAlsoTranslation(tafsir))
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
