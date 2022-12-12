/* jslint node:true, esversion:8 */
'use strict';

const express = require('express');
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
  for (var i = 0; i < results.length; i++)
    results[i].similar = await Hadith.a_getSimilarCandidates(results[i].id);
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
      toc: await getBookTOC(book.id)
    });
  } else
    res.status(404).send('Book not found');
});

router.get('/:bookAlias/:chapterNum', async function (req, res, next) {
  var book = global.books.find(function (value) {
    return (value.alias == req.params.bookAlias || value.id == req.params.bookAlias);
  });
  if (book && !isNaN(req.params.chapterNum)) {
    var currentChapterNum = parseFloat(req.params.chapterNum);
    var prevChapter = null;
    var nextChapter = null;
    var firstChapter = await getFirstChapter(book.id);
    var lastChapter = await getLastChapter(book.id);
    if (currentChapterNum < firstChapter.h1 || currentChapterNum > lastChapter.h1) {
      res.status(404).send('Chapter not found');
      return;
    }
    if (currentChapterNum > firstChapter.h1 && currentChapterNum <= lastChapter.h1)
      prevChapter = await getChapterHeading(book.id, currentChapterNum - 1);
    if (currentChapterNum >= firstChapter.h1 && currentChapterNum < lastChapter.h1)
      nextChapter = await getChapterHeading(book.id, currentChapterNum + 1);
    res.render('chapter', {
      book: book,
      prevChapter: prevChapter,
      nextChapter: nextChapter,
      results: await getChapter(book.id, currentChapterNum)
    });
  } else
    res.status(404).send('Chapter not found');
});

async function getBookTOC(bookId) {
  return await global.query(`
    SELECT * FROM toc
    WHERE bookId=${bookId} AND level > 0 AND level < 3
    ORDER BY h1, h2, h3`);
}

async function getChapterHeading(bookId, chapterNum) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${bookId} AND h1=${chapterNum} AND level=1
    ORDER BY h1, h2, h3`);
  return chapterHeadings[0];
}

async function getChapter(bookId, chapterNum) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${bookId} AND h1=${chapterNum} 
    ORDER BY h1, h2, h3`);
  var chapter = chapterHeadings.shift();
  var hadithRows = await global.query(`
    SELECT * FROM hadiths 
    WHERE bookId=${bookId} AND h1=${chapterNum}
    ORDER BY h1, numInChapter, num0`);
  var hadiths = [];
  for (var i = 0; i < hadithRows.length; i++) {
    hadiths.push(new Hadith(hadithRows[i], true));
  }
  return {
    chapter: chapter,
    headings: chapterHeadings,
    hadiths: hadiths
  };
}

async function getFirstChapter(bookId) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${bookId} AND level=1 
    ORDER BY h1 ASC 
    LIMIT 1;
  `);
  return chapterHeadings[0];
}

async function getLastChapter(bookId) {
  var chapterHeadings = await global.query(`
    SELECT * FROM toc 
    WHERE bookId=${bookId} AND level=1 
    ORDER BY h1 DESC 
    LIMIT 1;
  `);
  return chapterHeadings[0];
}

module.exports = router;
