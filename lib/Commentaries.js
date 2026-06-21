'use strict';

const Books = require('./Books');

async function loadCommentaries() {
  const commentaries = await Books.allCommentaryBooks();
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
  await Books.refreshUnifiedCatalog();
  return global.commentaries;
}

module.exports = {
  loadCommentaries
};
