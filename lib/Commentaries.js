'use strict';

async function loadCommentaries() {
  global.tafsirCarouselBooks = null;
  global.tafsirFirstPassages = null;
  global.commentaries = await global.query(`
    SELECT alias, shortName_en, shortName, name_en, name, author_en, author,
      death, lang, source, format, ordinal, surah_dir, hidden
    FROM books_commentaries
    ORDER BY lang, ordinal, id`);
  global.commentariesByAlias = new Map();
  global.tafsirAppAliases = new Set();
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
