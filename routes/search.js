/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify').default;
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');
const Utils = require('../lib/Utils');
const { Section, Chapter, Item, Library, Record } = require('../lib/Model');
const Index = require('../lib/Index');

const router = asyncify(express.Router());

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
  var domain = `https://hadithunlocked.com`;
  res.write(`${domain}\n`);
  res.write(`${domain}/books\n`);
  res.write(`${domain}/recent\n`);
  res.write(`${domain}/requests\n`);
  var results = await global.query(`
    select b.alias, null as h1, null as h2 from books b
    union
    select b.alias, t.h1, t.h2 from toc t, books b
    where t.bookId = b.id and t.level < 3
    union
    select distinct 'tag' as alias,t.text_en as h1, null as h2 from tags t, hadiths_tags ht
    where t.id = ht.tagId
    order by alias, h1  
  `);
  for (var i = 0; i < results.length; i++) {
    var alias = results[i].alias;
    var h1 = Utils.emptyIfNull(results[i].h1).replace(/(\.0+|0+)$/, '');
    var h2 = Utils.emptyIfNull(results[i].h2);
    res.write(`${domain}/${alias}${(h1 ? '/' + h1 : '')}${(h2 ? '/' + h2 : '')}\n`);
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
      if (req.query.b && (typeof req.query.b) != 'object')
        req.query.b = [req.query.b];
      results = await Search.a_searchText(req.query.q, req.query.b);
      results.map(function (hadith) {
        if (hadith.chapter) {
          hadith.chapter.offset = Math.floor(hadith.numInChapter / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage;
          if (hadith.chapter.offset > 0)
            hadith.chapter.offset = '?o=' + hadith.chapter.offset;
          else
            hadith.chapter.offset = '';
        }
      });
    } catch (err) {
      var message = `Error searching [${req.query.q} ${req.query.b}]`;
      console.error(message + `\n${err.stack}`);
      throw createError(500, message);
    }
    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else {
      res.render('search', {
        results: results,
        q: req.query.q,
        b: (req.query.b ? req.query.b : []),
      });
    }
  } else {
    results = await Index.docRandomnly('hadiths');
    if (results.length > 0) {
      res.redirect(`/${results[0].book_alias}:${results[0].num}`);
    } else {
      res.render('search', {
        results: results,
        b: [],
      });
    }
  }
});

// QURAN (RANGE)
router.get('/passage\::surah\::ayah1-:ayah2', async function (req, res, next) {
  return await a_getPassage(req.params.surah, req.params.ayah1, req.params.ayah2, req, res, next);
});

router.get('/passage\::surah\::ayah1', async function (req, res, next) {
  return await a_getPassage(req.params.surah, req.params.ayah1, req.params.ayah1, req, res, next)
});

async function a_getPassage(surah, ayah1, ayah2, req, res, next) {
  var results = await Search.a_lookupQuranByRange(surah, ayah1, ayah2);
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {
    throw createError(501, "Passage view is not implemented");
  }
};

// HADITH (SINGLE)
router.get('/:bookAlias\::num', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = await Index.docsFromKeyValue('hadiths', { ref: `${req.params.bookAlias}:${req.params.num}` });
  results = results.map(item => new Item(item));
  for (var i = 0; i < results.length; i++) {
    results[i].similar = await Hadith.a_dbGetSimilarCandidates(new Item(results[i]));
    var bookSet = new Set();
    for (var j = 0; results[i].similar && j < results[i].similar.length; j++) {
      results[i].similar[j].parentId = results[i].id;
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
    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else {
      res.render('search', {
        results: results,
        book: results[0].book,
        q: req.query.q,
        b: [],
      });
    }
  } else {
    res.render('search', {
      results: results,
      q: req.query.q,
      b: [],
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
    var results = await Library.instance.findBook(req.params.bookAlias).getChapters();
    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else {
      res.render('toc', {
        book: book,
        prevBook: prevBook,
        nextBook: nextBook,
        toc: results
      });
    }
  } else
    throw createError(404, `Book '${req.params.bookAlias}' does not exist`);
});

// BOOK: CHAPTER
router.get('/:bookAlias/:chapterNum', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    var chapterNum = req.params.chapterNum;
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;

    var chapter = await Chapter.chapterFromRef(`${bookAlias}/${chapterNum}`);
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    results = await chapter.getItems(offset);

    res.render('chapter', {
      chapter: chapter,
      results: results
    });

  } catch (e) {
    if (e instanceof ReferenceError)
      throw createError(404, e.message);
    else {
      console.log(e.stack);
      throw createError(500, e.message);
    }
  }

});

// BOOK: SECTION
router.get('/:bookAlias/:chapterNum/:sectionNum', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    var chapterNum = req.params.chapterNum;
    var sectionNum = req.params.sectionNum;
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;

    var section = await Section.sectionFromRef(`${bookAlias}/${chapterNum}/${sectionNum}`);
    await section.getPrev();
    await section.getNext();
    var chapter = await section.getChapter();
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    results = await section.getItems(offset);
    if (results.length == 0) {
      var item = new Item(section);
      item.id = item.hId = undefined;
      results.push(item);
    }

    res.render('section', {
      section: section,
      results: results
    });

  } catch (e) {
    if (e instanceof ReferenceError)
      throw createError(404, e.message);
    else {
      console.log(e.stack);
      throw createError(500, e.message);
    }
  }

});

module.exports = router;
