/* jslint node:true, esversion:8 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');

const router = asyncify(express.Router());

router.get('/reinit', function (req, res, next) {
  res.send('<h1>NOTE</h1><p>Database is initializing, please wait a few seconds before your changes will take effect.</p>');
});

router.get('/', async function (req, res, next) {
  var results = [];
  if (req.query.q) {
    req.query.q = req.query.q.trim();
    if (req.query.q.match(/^([a-z]+:\d+|\d+)/)) {
      res.redirect('/' + req.query.q);
      return;
    }
    results = await Search.a_searchText(req.query.q);
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

router.get('/:bookAlias\::num', async function (req, res, next) {
  var results = await Search.a_lookupByRef(req.params.bookAlias, req.params.num);
  for (var i = 0; i < results.length; i++) {
    results[i].similar = await Hadith.a_getSimilarCandidates(results[i].id);
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

router.get('/:bookAlias', async function (req, res, next) {
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

router.get('/:bookAlias/:chapterNum', async function (req, res, next) {
  var book = global.books.find(function (value) {
    return (value.alias == req.params.bookAlias || value.id == req.params.bookAlias);
  });
  if (book && !isNaN(req.params.chapterNum)) {
    var currentChapterNum = parseFloat(req.params.chapterNum);
    var prevChapter = null;
    var nextChapter = null;
    var firstChapter = await getFirstChapter(book);
    var lastChapter = await getLastChapter(book);
    if (currentChapterNum < firstChapter.h1 || currentChapterNum > lastChapter.h1)
      throw createError(404, `Chapter '${req.params.bookAlias}/${req.params.chapterNum}' does not exist`);
    if (currentChapterNum > firstChapter.h1 && currentChapterNum <= lastChapter.h1)
      prevChapter = await getChapterHeading(book, currentChapterNum - 1);
    if (currentChapterNum >= firstChapter.h1 && currentChapterNum < lastChapter.h1)
      nextChapter = await getChapterHeading(book, currentChapterNum + 1);
    res.render('chapter', {
      book: book,
      prevChapter: prevChapter,
      nextChapter: nextChapter,
      results: await getChapter(book, currentChapterNum)
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

async function getChapterHeading(book, chapterNum) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${book.id} AND h1=${chapterNum} AND level=1
    ORDER BY h1, h2, h3`);
  return chapterHeadings[0];
}

async function getChapter(book, chapterNum) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${book.id} AND h1=${chapterNum} 
    ORDER BY h1, h2, h3`);
  var chapter = chapterHeadings.shift();
  var hadithRows = [];
  if (!book.virtual) {
    hadithRows = await global.query(`
      SELECT * FROM hadiths 
      WHERE bookId=${book.id} AND h1=${chapterNum}
      ORDER BY h1, numInChapter, num0`);
  } else {
    hadithRows = await global.query(`
      SELECT h.*, hv.num as numVirtual
      FROM hadiths_virtual hv, hadiths h
      WHERE hv.bookId=${book.id} AND hv.h1=${chapterNum} AND hv.hadithId=h.id
      ORDER BY hv.h1, hv.numInChapter, hv.num0`);
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

async function getFirstChapter(book) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${book.id} AND level=1 
    ORDER BY h1 ASC 
    LIMIT 1;
  `);
  return chapterHeadings[0];
}

async function getLastChapter(book) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${book.id} AND level=1 
    ORDER BY h1 DESC 
    LIMIT 1;
  `);
  return chapterHeadings[0];
}

module.exports = router;
