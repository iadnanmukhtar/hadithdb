/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');
const Utils = require('../lib/Utils');

const router = asyncify(express.Router());

global.MAX_PER_PAGE = 250;

router.get('/reinit', async function (req, res, next) {
  await Hadith.a_reinit();
  res.write('Done');
  res.end();
  return;
});


router.get('/do/:id', async function (req, res, next) {
  if (req.query.cmd == 'tr') {
    // translation request
    try {
      var id = parseInt(req.params.id);
      await global.query(`UPDATE hadiths SET requested=(requested+1) WHERE id=${id}`);
      res.sendStatus(204);
      res.end();
      return;
    } catch (err) {
      var message = `Error in action [${req.params.id}?${req.query.action}]`;
      console.error(message + `\n${err.stack}`);
      throw createError(500, message);
    }
  }
  throw createError(501, 'Action unknown');
});

// SITEMAP
router.get('/sitemap\.txt', async function (req, res, next) {
  res.setHeader('content-type', 'text/plain');
  var domain = `https://hadith.quranunlocked.com`;
  res.write(`${domain}\n`);
  res.write(`${domain}/books\n`);
  res.write(`${domain}/recent\n`);
  res.write(`${domain}/requests\n`);
  var results = await global.query(`
    select b.alias,null as h1 from books b
    union
    select b.alias,t.h1 from toc t, books b
    where t.bookId = b.id and t.level=1
    union
    select distinct 'tag' as alias,t.text_en as h1 from tags t, hadiths_tags ht
    where t.id = ht.tagId
    order by alias, h1  
  `);
  for (var i = 0; i < results.length; i++) {
    var alias = results[i].alias;
    var h1 = Utils.emptyIfNull(results[i].h1).replace(/(\.0+|0+)$/, '');
    res.write(`${domain}/${alias}${(h1 ? '/' + h1 : '')}\n`);
  }
  res.end();
  return;
});

// HOME (SEARCH OR SHOW RANDOM HADITH)
router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = [];
  if (req.query.q) {
    req.query.q = req.query.q.trim();
    if (req.query.q.match(/^([a-z]+:\d+|\d+)/)) {
      res.redirect('/' + req.query.q);
      return;
    }
    try {
      results = await Search.a_searchText(req.query.q);
    } catch (err) {
      var message = `Error searching [${req.query.q}]`;
      console.error(message + `\n${err.stack}`);
      throw createError(500, message);
    }
    res.render('search', {
      q: req.query.q,
      results: results
    });
  } else {
    results = [await Search.a_getRandom()];
    if (results.length > 0) {
      res.redirect(`/${results[0].book.alias}:${results[0].num}`);
    } else {
      res.render('search', {
        results: results
      });
    }
  }
});

// HADITH (SINGLE)
router.get('/:bookAlias\::num', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = await Search.a_lookupByRef(req.params.bookAlias, req.params.num);
  for (var i = 0; i < results.length; i++) {
    results[i].similar = await Hadith.a_dbGetSimilarCandidates(results[i].id);
    var bookSet = new Set();
    for (var j = 0; results[i].similar && j < results[i].similar.length; j++) {
      var book = global.books.find(function (value) {
        return results[i].similar[j].bookId == value.id;
      });
      if (book) bookSet.add(book);
    }
    results[i].similarBooks = Array.from(bookSet);
    results[i].similarBooks.sort(function (book1, book2) {
      return book1.id - book2.id;
    });
  }
  if (results.length > 0) {
    res.render('search', {
      book: results[0].book,
      q: req.query.q,
      results: results
    });
  } else {
    res.render('search', {
      q: req.query.q,
      results: results
    });
  }
});

// BOOK: TABLE OF CONTENTS
router.get('/:bookAlias', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var book = global.books.find(function (value) {
    return (value.alias == req.params.bookAlias || value.id == req.params.bookAlias);
  });
  if (book) {
    var prevBook = null;
    var nextBook = null;
    var bookIdx = global.books.findIndex(function (value, index, arr) {
      return (value.id == book.id);
    });
    if (bookIdx > 0)
      prevBook = global.books[bookIdx - 1];
    if (bookIdx < (global.books.length - 1))
      nextBook = global.books[bookIdx + 1];
    res.render('toc', {
      book: book,
      prevBook: prevBook,
      nextBook: nextBook,
      toc: await getBookTOC(book)
    });
  } else
    throw createError(404, `Book '${req.params.bookAlias}' does not exist`);
});

// BOOK: CHAPTER
router.get('/:bookAlias/:chapterNum', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var book = global.books.find(function (value) {
    return (value.alias == req.params.bookAlias || value.id == req.params.bookAlias);
  });
  if (book && !isNaN(req.params.chapterNum)) {
    var currentChapterNum = parseFloat(req.params.chapterNum);
    var offset = 0;
    if (req.query.o)
      offset = Math.floor(parseFloat(req.query.o) / global.MAX_PER_PAGE) * global.MAX_PER_PAGE;
    var results = await a_dbGetChapter(book, currentChapterNum, offset);
    if (!results)
      throw createError(404, `Chapter '${req.params.bookAlias}/${req.params.chapterNum}' does not exist`);
    var hadiths = results.hadiths;
    hadiths.pg = (offset / global.MAX_PER_PAGE) + 1;
    hadiths.offset = offset;
    hadiths.hasNext = (hadiths.length > global.MAX_PER_PAGE);
    if (hadiths.hasNext)
      hadiths.pop();
    hadiths.prevOffset = ((offset - global.MAX_PER_PAGE) < global.MAX_PER_PAGE) ? 0 : offset - global.MAX_PER_PAGE;
    hadiths.nextOffset = offset + global.MAX_PER_PAGE;
    hadiths.hasPrev = ((offset - global.MAX_PER_PAGE) >= 0);
    if (!hadiths.hasNext)
      delete hadiths.nextOffset;
    if (results.hadiths.length == 0)
      throw createError(404, `Page ${hadiths.pg} of Chapter '${req.params.bookAlias}/${req.params.chapterNum}' does not exist`);

    var currChapter = results.chapter;
    var prevChapter = null;
    var nextChapter = null;
    var firstChapter = await a_dbGetFirstChapter(book);
    var lastChapter = await a_dbGetLastChapter(book);
    if (currentChapterNum < firstChapter.h1 || currentChapterNum > lastChapter.h1)
      throw createError(404, `Chapter '${req.params.bookAlias}/${req.params.chapterNum}' does not exist`);
    if (currentChapterNum > firstChapter.h1 && currentChapterNum <= lastChapter.h1)
      prevChapter = await a_dbGetPrevChapterHeading(currChapter, currChapter.ordinal - 1);
    if (currentChapterNum >= firstChapter.h1 && currentChapterNum < lastChapter.h1)
      nextChapter = await a_dbGetNextChapterHeading(currChapter, currChapter.ordinal + 1);

    res.render('chapter', {
      book: book,
      prevChapter: prevChapter,
      nextChapter: nextChapter,
      results: results
    });
  } else
    throw createError(404, `Chapter '${req.params.bookAlias}/${req.params.chapterNum}' does not exist`);
});


async function getBookTOC(book) {
  return await global.query(`
    SELECT * FROM toc
    WHERE bookId=${book.id} AND level > 0 AND level < 3
    ORDER BY h1, h2, h3`);
}

async function a_dbGetPrevChapterHeading(currChapter) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${currChapter.bookId} AND ordinal < ${currChapter.ordinal} AND level=1 AND start0 IS NOT NULL
    ORDER BY ordinal DESC
    LIMIT 1`);
  return chapterHeadings[0];
}

async function a_dbGetNextChapterHeading(currChapter) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${currChapter.bookId} AND ordinal > ${currChapter.ordinal} AND level=1 AND start0 IS NOT NULL
    ORDER BY ordinal
    LIMIT 1`);
  return chapterHeadings[0];
}

async function a_dbGetChapter(book, chapterNum, offset) {
  var chapterHeadings = [];
  if (!book.virtual)
    chapterHeadings = await global.query(`
      SELECT t.*, h.numInChapter FROM toc t, hadiths h
      WHERE t.bookId=${book.id} AND t.h1=${chapterNum}
        AND t.bookId = h.bookId
        AND t.h1 = h.h1
        AND t.start0 = h.num0
      ORDER BY h1, h2, h3`);
  else {
    chapterHeadings = await global.query(`
    SELECT t.*, 0 as numInChapter FROM toc t
      WHERE t.bookId=${book.id} AND t.h1=${chapterNum}
      ORDER BY h1, h2, h3`);
  }
  var chapter = chapterHeadings.shift();
  if (!chapter || chapter.level != 1)
    return null;
  var hadithRows = [];
  if (!book.virtual) {
    hadithRows = await global.query(`
      SELECT * FROM hadiths 
      WHERE bookId=${book.id} AND h1=${chapterNum}
      ORDER BY h1, numInChapter, num0
      LIMIT ${offset},${global.MAX_PER_PAGE + 1}`);
  } else {
    hadithRows = await global.query(`
      SELECT h.*, hv.num as numVirtual
      FROM hadiths_virtual hv, hadiths h
      WHERE hv.bookId=${book.id} AND hv.h1=${chapterNum} AND hv.hadithId=h.id
      ORDER BY hv.h1, hv.numInChapter, hv.num0
      LIMIT ${offset}, ${global.MAX_PER_PAGE + 1}`);
  }
  var hadiths = [];
  for (var i = 0; i < hadithRows.length; i++) {
    var hadith = new Hadith(hadithRows[i]);
    if (book.virtual)
      await Hadith.a_dbHadithInit(hadith);
    hadiths.push(hadith);
  }
  return {
    chapter: chapter,
    headings: chapterHeadings,
    hadiths: hadiths
  };
}

async function a_dbGetFirstChapter(book) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${book.id} AND level=1 
    ORDER BY h1 ASC 
    LIMIT 1;
  `);
  return chapterHeadings[0];
}

async function a_dbGetLastChapter(book) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${book.id} AND level=1 
    ORDER BY h1 DESC 
    LIMIT 1;
  `);
  return chapterHeadings[0];
}

module.exports = router;
