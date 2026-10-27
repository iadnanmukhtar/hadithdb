'use strict';
const Links = require('../public/static/js/quran-reader-links');

function context(req, page, locals) {
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const query = req.query || {};
  const ctx = page.context || {}, section = ctx.section || ctx.heading || {}, chapter = ctx.chapter || {};
  const commentary = ctx.quranCommentaryBook;
  const isMushaf = /\/quran\/page(?:\/|$)/.test(path);
  const isReview = path === '/quran/review' || isMushaf && (query.review !== undefined || query.reviewRef !== undefined);
  const isStudy = ctx.passage && !isMushaf && !path.startsWith('/quran/tafsir') && !path.startsWith('/quran/translations');
  const isTafsir = path.startsWith('/quran/tafsir') || !isStudy && commentary && commentary.type === 'tafsir';
  const isTranslations = path.startsWith('/quran/translations');
  const mode = isReview ? 'review' : isMushaf ? query.memorize !== undefined ? 'memorize' : 'mushaf' : isTafsir ? 'tafsir' : isTranslations ? 'translations' : isStudy || /quran:\d+:\d+/.test(path) ? 'passage' : 'catalog';
  const routeRef = (path.match(/quran:(\d+:\d+(?:-\d+)?)/) || [])[1];
  const ref = [ctx.quranReaderRef, query.ayah, query.reviewRef, query.review, locals.selectedAyahRef, routeRef, locals.firstRef, section.start, chapter.start, chapter.h1 && `${chapter.h1}:1`].map(Links.reference).find(Boolean) || '';
  const pageNumber = Number(isMushaf ? (path.match(/\/page\/(\d+)/) || [])[1] : section.mushafPage || locals.quranReaderPage);
  const selectedStudyBook = commentary && commentary.type === 'trans' ? commentary : null;
  const studyAlias = selectedStudyBook && (selectedStudyBook.quranBookSlug || selectedStudyBook.alias) || req.quranSelectedTranslationAlias || req.cookies && req.cookies.quranPreferredTranslationAlias || '';
  const studyBook = /^[A-Za-z0-9_-]+$/.test(studyAlias) ? studyAlias : '';
  const tafsirBook = isTafsir && commentary ? commentary.slug || commentary.alias : '';
  const paths = Links.paths({ ref, page: pageNumber, studyBook, tafsirBook, script: query.script, ayat: query.ayat !== undefined });
  return { mode, ref, page: Number.isInteger(pageNumber) ? pageNumber : '', studyBook, tafsirBook, paths,
    navigationMode: isTranslations ? 'translations' : isTafsir ? 'tafsir' : isMushaf || isReview ? mode : 'study',
    navigationBook: isTafsir ? commentary || { alias: 'mokhtasar', type: 'tafsir' } : selectedStudyBook || (studyBook ? { alias: studyBook, type: 'trans' } : null) };
}
module.exports = { context };
