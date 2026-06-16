'use strict';

async function loadCommentaries() {
  const commentaries = await global.query(`
    SELECT alias, type, shortName_en, shortName, name_en, name, author_en, author,
      death, description, aqidah, lang, source, format, ordinal, surah_dir, hidden
    FROM books_commentaries
    ORDER BY type, lang, ordinal, id`);
  global.commentaries = commentaries;
  global.commentariesByAlias = new Map();
  global.tafsirAppAliases = new Set();
  global.tafsirCarouselBooks = null;
  global.tafsirFirstPassages = null;
  global.commentaries.forEach(commentary => {
    if (!commentary || !commentary.alias)
      return;
    if (!global.commentariesByAlias.has(commentary.alias))
      global.commentariesByAlias.set(commentary.alias, []);
    global.commentariesByAlias.get(commentary.alias).push(commentary);
    if (commentary.source === 'tafsir.app')
      global.tafsirAppAliases.add(commentary.alias);
  });
  return global.commentaries;
}

module.exports = {
  loadCommentaries
};
